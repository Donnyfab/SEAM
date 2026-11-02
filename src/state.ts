import { signal, computed, effect } from '@preact/signals'
import { PlaybackEngine, type EngineState, type PlayItem } from './audio/engine'
import { BookPlayer, type BookState } from './audio/bookPlayer'
import { isNeutral } from './audio/presets'
import { gainForTarget, measureLufs, samplePeak } from './audio/loudness'
import { makeTransition } from './core/crossfade'
import { shuffleUpcoming, makeQueue } from './core/queue'
import { importFiles } from './library/importer'
import { finishAuth, setSourceSaver } from './connect/cloud'
import { createAdapter, type RemoteNode, type Source } from './connect/sources'
import {
  defaultSettings, loadSources, saveSources, loadBookmarks, loadPositions, savePositions, saveBookmarks, saveArt, type Bookmark, deleteTrack, loadArrangements, loadArt, loadFile, loadPlaylists, loadSettings, loadTracks,
  saveArrangements, savePlaylists, saveSettings, saveTrack, type Playlist, type Settings, type StoredTrack,
} from './library/store'
import type { Arrangement } from './core/arrangement'

export const tracks = signal<StoredTrack[]>([])
export const playlists = signal<Playlist[]>([])
export const arrangements = signal<Arrangement[]>([])
export const settings = signal<Settings>(defaultSettings)
export const ready = signal(false)
export const engineState = signal<EngineState>({ status: 'idle', index: -1, duration: 0 })
export const queueIds = signal<string[]>([])
export const shuffle = signal(false)
export const bookmarks = signal<Bookmark[]>([])
export const positions = signal<Record<string, number>>({})
export const bookState = signal<BookState>({ status: 'idle', trackId: null, position: 0, duration: 0, rate: 1 })
export const toast = signal<string | null>(null)
/** id of the arrangement currently being played from Studio, else null */
export const playingArrangement = signal<string | null>(null)

/** Tracks streamed from remote sources: playable, but not part of the library until downloaded. */
export const ephemeral = signal<StoredTrack[]>([])
export const sources = signal<Source[]>([])
const remoteLoaders = new Map<string, () => Promise<Blob>>()
export const trackById = computed(() => new Map([...tracks.value, ...ephemeral.value].map(t => [t.id, t])))

export function notify(msg: string) { toast.value = msg; setTimeout(() => { if (toast.value === msg) toast.value = null }, 3500) }

// ---- artwork object URLs ----
const artUrls = new Map<string, string | null>()
export async function artworkUrl(id: string): Promise<string | null> {
  if (artUrls.has(id)) return artUrls.get(id) ?? null
  const b = await loadArt(id)
  const url = b ? URL.createObjectURL(b) : null
  artUrls.set(id, url)
  return url
}

// ---- decoding with a small LRU ----
const decoded = new Map<string, AudioBuffer>()
const inflight = new Map<string, Promise<AudioBuffer>>()
export function decodeTrack(id: string, ctx: BaseAudioContext): Promise<AudioBuffer> {
  const hit = decoded.get(id)
  if (hit) { decoded.delete(id); decoded.set(id, hit); return Promise.resolve(hit) }
  const pending = inflight.get(id)
  if (pending) return pending
  const p = (async () => {
    const remote = remoteLoaders.get(id)
    const blob = remote ? await remote() : await loadFile(id)
    if (!blob) throw new Error('Audio file missing from storage')
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    decoded.set(id, buf)
    void measureOnce(id, buf)
    while (decoded.size > 3) decoded.delete(decoded.keys().next().value as string)
    return buf
  })().finally(() => inflight.delete(id))
  inflight.set(id, p)
  return p
}

/** Loudness is measured once per track (after the first decode) and stored with the track. */
async function measureOnce(id: string, buf: AudioBuffer) {
  const t = trackById.peek().get(id)
  if (!t || t.lufs !== undefined) return
  const ch = Array.from({ length: Math.min(buf.numberOfChannels, 2) }, (_, i) => buf.getChannelData(i))
  const next = { ...t, lufs: measureLufs(ch, buf.sampleRate), peak: samplePeak(ch) }
  tracks.value = tracks.peek().map(x => (x.id === id ? next : x))
  await saveTrack(next)
}

/** Decode without keeping the PCM around (used by export so only one track is resident at a time). */
export async function decodeTrackUncached(id: string, ctx: BaseAudioContext): Promise<AudioBuffer> {
  const hit = decoded.get(id)
  if (hit) return hit
  const blob = await loadFile(id)
  if (!blob) throw new Error('Audio file missing from storage')
  return ctx.decodeAudioData(await blob.arrayBuffer())
}

let engine: PlaybackEngine | null = null
export function getEngine(): PlaybackEngine {
  if (engine) return engine
  engine = new PlaybackEngine()
  engine.fx.apply(settings.value.fx)
  engine.setFxRouting({ neutral: isNeutral(settings.value.fx) })
  engine.subscribe(s => { engineState.value = s })
  return engine
}

let book: BookPlayer | null = null
export function getBook(): BookPlayer {
  if (book) return book
  book = new BookPlayer()
  book.subscribe(s => { bookState.value = s })
  book.onProgress = (id, pos) => rememberPosition(id, pos)
  return book
}

export function rememberPosition(id: string, pos: number) {
  const t = trackById.peek().get(id)
  const next = { ...positions.peek() }
  if (!t || pos < 5 || pos > t.duration - 15) delete next[id]; else next[id] = pos
  positions.value = next
  void savePositions(next)
}

export const isLong = (t: { duration: number; kind?: string }) => t.kind === 'audiobook' || t.duration >= 600

/** Plays an audiobook / long file through the streaming player, resuming where you left off. */
export async function playBook(id: string, startAt?: number) {
  const t = trackById.peek().get(id); if (!t) return
  engine?.stop()
  const blob = await loadFile(id)
  if (!blob) return notify('Audio file missing from storage')
  const url = await artworkUrl(id)
  try { await getBook().load(blob, { id, title: t.title, artist: t.artist, album: t.album, artwork: url ?? undefined }, startAt ?? positions.peek()[id] ?? 0, settings.peek().bookRate) }
  catch (e) { notify(e instanceof Error ? e.message : 'Playback failed') }
}

export async function addBookmark(trackId: string, time: number, label?: string) {
  const t = trackById.peek().get(trackId)
  const b: Bookmark = { id: crypto.randomUUID(), trackId, time, label: label || `${t?.title ?? 'Bookmark'}`, createdAt: Date.now() }
  bookmarks.value = [...bookmarks.peek(), b]
  await saveBookmarks(bookmarks.peek())
  notify('Bookmark added')
}
export async function removeBookmark(id: string) { bookmarks.value = bookmarks.peek().filter(b => b.id !== id); await saveBookmarks(bookmarks.peek()) }
export async function playBookmark(b: Bookmark) {
  const t = trackById.peek().get(b.trackId); if (!t) return notify('That song was deleted')
  if (t.kind === 'audiobook') return playBook(t.id, b.time)
  await playTracks([t], 0, b.time)
}

export async function updateTrack(id: string, patch: Partial<StoredTrack>) {
  const t = trackById.peek().get(id); if (!t) return
  const next = { ...t, ...patch }
  tracks.value = tracks.peek().map(x => (x.id === id ? next : x))
  await saveTrack(next)
}
export async function setArtwork(id: string, file: Blob) {
  const bmp = await createImageBitmap(file)
  const s = Math.min(1, 512 / Math.max(bmp.width, bmp.height))
  const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s))
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close()
  await saveArt(id, await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 }))
  const old = artUrls.get(id); if (old) URL.revokeObjectURL(old)
  artUrls.delete(id)
  tracks.value = [...tracks.peek()] // refresh listeners
}

export function toPlayItem(t: StoredTrack): PlayItem {
  return {
    id: t.id, title: t.title, artist: t.artist, album: t.album,
    load: ctx => decodeTrack(t.id, ctx),
    gainFor: buf => {
      if (!settings.peek().normalize) return 1
      const cur = trackById.peek().get(t.id)
      let lufs = cur?.lufs, peak = cur?.peak
      if (lufs === undefined || peak === undefined) { // first play: measure inline so the very first listen is normalized too
        const ch = Array.from({ length: Math.min(buf.numberOfChannels, 2) }, (_, i) => buf.getChannelData(i))
        lufs = measureLufs(ch, buf.sampleRate); peak = samplePeak(ch)
      }
      return Number.isFinite(lufs) ? gainForTarget(lufs, settings.peek().targetLufs, peak) : 1
    },
  }
}

/** Replace the queue and start playback (global crossfade applies; Studio overrides this per transition). */
export async function playTracks(list: StoredTrack[], start = 0, offset?: number) {
  if (!list.length) return
  book?.stop()
  const e = getEngine()
  let ids = list.map(t => t.id)
  if (shuffle.value) {
    const q = shuffleUpcoming(makeQueue(ids, start))
    ids = q.items
  }
  queueIds.value = ids
  playingArrangement.value = null
  e.setFxRouting({ bypass: false })
  e.transitionAfter = undefined
  e.crossfade = settings.value.crossfade
  e.repeat = settings.value.repeat
  e.setItems(ids.map(id => toPlayItem(trackById.value.get(id)!)))
  const cur = list[start]
  const resume = offset ?? (cur && isLong(cur) ? positions.peek()[cur.id] : undefined)
  await e.play(ids.indexOf(cur?.id ?? ''), resume ?? 0)
}

export async function toggleFavorite(id: string) {
  const t = trackById.value.get(id); if (!t) return
  const next = { ...t, favorite: !t.favorite }
  tracks.value = tracks.value.map(x => (x.id === id ? next : x))
  await saveTrack(next)
}

export function remoteTrack(source: Source, node: RemoteNode): StoredTrack {
  const m = node.track
  const id = `remote:${source.id}:${node.id}`
  const t: StoredTrack = {
    id, title: m?.title ?? node.title, artist: m?.artist ?? 'Unknown Artist', album: m?.album ?? 'Unknown Album', duration: m?.duration ?? 0,
    trackNo: m?.trackNo, year: m?.year, genre: m?.genre, addedAt: Date.now(), playCount: 0, favorite: false, fileName: node.fileName ?? node.title,
  }
  remoteLoaders.set(id, () => createAdapter(source).blob(node))
  return t
}

/** Stream remote tracks through the normal player (downloads each file into memory, then decodes). */
export async function playRemote(source: Source, nodes: RemoteNode[], start = 0) {
  const list = nodes.map(n => remoteTrack(source, n))
  ephemeral.value = list
  await playTracks(list, start)
}

export async function downloadRemote(source: Source, nodes: RemoteNode[], onProgress?: (d: number, t: number) => void) {
  const adapter = createAdapter(source)
  const files: File[] = []
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!
    const blob = await adapter.blob(n)
    files.push(new File([blob], n.fileName ?? n.title, { type: blob.type || 'audio/mpeg', lastModified: 0 }))
    onProgress?.(i + 1, nodes.length)
  }
  return importAudio(files)
}

export async function saveSource(s: Source) {
  const list = sources.peek()
  sources.value = list.some(x => x.id === s.id) ? list.map(x => (x.id === s.id ? s : x)) : [...list, s]
  await saveSources(sources.peek())
}
export async function removeSource(id: string) { sources.value = sources.peek().filter(x => x.id !== id); await saveSources(sources.peek()) }

/** Stream an internet-radio URL (or any direct stream) with the media-element player. */
export async function playStream(name: string, url: string) {
  engine?.stop()
  try { await getBook().loadStream(url, { id: `stream:${url}`, title: name, artist: 'Internet radio', album: url }) }
  catch { notify('Could not play that stream. Browsers need https:// streams.') }
}

export async function removeTrack(id: string) {
  tracks.value = tracks.value.filter(t => t.id !== id)
  playlists.value = playlists.value.map(p => ({ ...p, trackIds: p.trackIds.filter(x => x !== id) }))
  await Promise.all([deleteTrack(id), savePlaylists(playlists.value)])
}

export async function importAudio(files: File[], onProgress?: (d: number, t: number) => void) {
  const res = await importFiles(files, tracks.value, onProgress)
  tracks.value = [...tracks.value, ...res.added]
  if (res.failed.length) notify(`${res.failed.length} file(s) failed: ${res.failed[0]!.name} — ${res.failed[0]!.reason}`)
  else if (res.added.length) notify(`Added ${res.added.length} track${res.added.length === 1 ? '' : 's'}`)
  return res
}

export async function createPlaylist(name: string, trackIds: string[] = []) {
  playlists.value = [...playlists.value, { id: crypto.randomUUID(), name, trackIds, updatedAt: Date.now() }]
  await savePlaylists(playlists.value)
}
export async function updatePlaylist(id: string, patch: Partial<Playlist>) {
  playlists.value = playlists.value.map(p => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p))
  await savePlaylists(playlists.value)
}
export async function deletePlaylist(id: string) { playlists.value = playlists.value.filter(p => p.id !== id); await savePlaylists(playlists.value) }

export async function setArrangements(list: Arrangement[]) { arrangements.value = list; await saveArrangements(list) }

export async function updateSettings(p: Partial<Settings>) {
  settings.value = { ...settings.value, ...p }
  await saveSettings(settings.value)
  if (engine) { engine.crossfade = settings.value.crossfade; engine.repeat = settings.value.repeat; engine.fx.apply(settings.value.fx); engine.setFxRouting({ neutral: isNeutral(settings.value.fx) }) }
}

// Remember where you stopped in long (>10 min) music tracks.
effect(() => {
  const s = engineState.value
  const id = queueIds.peek()[s.index]
  const t = id ? trackById.peek().get(id) : undefined
  if (engine && t && t.kind !== 'audiobook' && isLong(t) && s.status === 'paused') rememberPosition(t.id, engine.position())
})

// Count a play when a new track becomes current.
let lastCounted = ''
effect(() => {
  const s = engineState.value
  const id = queueIds.peek()[s.index]
  if (s.status === 'playing' && id && id !== lastCounted) {
    lastCounted = id
    const t = trackById.peek().get(id)
    if (t) { const n = { ...t, playCount: t.playCount + 1, lastPlayedAt: Date.now() }; tracks.value = tracks.peek().map(x => (x.id === id ? n : x)); void saveTrack(n) }
  }
  if (s.status === 'idle') lastCounted = ''
})

export async function boot() {
  const [t, p, a, s, bm, pos] = await Promise.all([loadTracks(), loadPlaylists(), loadArrangements(), loadSettings(), loadBookmarks(), loadPositions()])
  bookmarks.value = bm; positions.value = pos
  sources.value = await loadSources()
  setSourceSaver(saveSource)
  try { const s = await finishAuth(); if (s) { await saveSource(s); notify(`Connected to ${s.name}`) } } catch (e) { notify(e instanceof Error ? e.message : 'Sign-in failed') }
  tracks.value = t; playlists.value = p; arrangements.value = a; settings.value = s
  try { await navigator.storage?.persist?.() } catch { /* best effort */ }
  ready.value = true
}
export { makeTransition }
