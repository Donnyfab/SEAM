import { t as translate } from './i18n'
import { signal, computed, effect } from '@preact/signals'
import { PlaybackEngine, type EngineState, type PlayItem } from './audio/engine'
import { BookPlayer, type BookState } from './audio/bookPlayer'
import { isNeutral } from './audio/presets'
import { gainForTarget } from './audio/loudness'
import { excerptChannels, measureLoudnessAsync } from './audio/dspClient'
import { makeTransition } from './core/crossfade'
import { shuffleUpcoming, makeQueue } from './core/queue'
import type { RemoteNode, Source } from './connect/sources'
import {
  defaultSettings, loadSources, saveSources, loadArtSmall, saveArtSmall, deleteArtSmall, deleteTrackRecord, deleteTrackFiles, findOrphans, loadBookmarks, loadPositions, savePositions, saveBookmarks, saveArt, type Bookmark, deleteTrack, loadArrangements, loadArt, loadFile, loadPlaylists, loadSettings, loadTracks,
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
export const undoToast = signal<{ msg: string; label: string; run: () => void } | null>(null)
let undoPending: { expire: () => void; timer: ReturnType<typeof setTimeout> } | null = null
/** Shows a toast with an Undo button. `expire` runs when the window closes without undo (or another undo toast replaces it). */
export function notifyUndo(msg: string, undo: () => void, expire: () => void, ms = 6000) {
  if (undoPending) { clearTimeout(undoPending.timer); undoPending.expire() }
  const timer = setTimeout(() => { undoPending = null; undoToast.value = null; expire() }, ms)
  undoPending = { expire, timer }
  undoToast.value = { msg, label: translate('Undo'), run: () => { clearTimeout(timer); undoPending = null; undoToast.value = null; undo() } }
}
window.addEventListener('pagehide', () => { if (undoPending) { clearTimeout(undoPending.timer); undoPending.expire(); undoPending = null } })
/** id of the arrangement currently being played from Studio, else null */
export const playingArrangement = signal<string | null>(null)

/** Tracks streamed from remote sources: playable, but not part of the library until downloaded. */
export const ephemeral = signal<StoredTrack[]>([])
export const sources = signal<Source[]>([])
const remoteLoaders = new Map<string, () => Promise<Blob>>()
export const trackById = computed(() => new Map([...tracks.value, ...ephemeral.value].map(t => [t.id, t])))

export function notify(msg: string) { toast.value = msg; setTimeout(() => { if (toast.value === msg) toast.value = null }, 3500) }

// ---- artwork object URLs (small thumbnails for lists, full size for big views) ----
const artUrls = new Map<string, string | null>()
const artInflight = new Map<string, Promise<string | null>>()
let artSlots = 0
const artWaiters: Array<() => void> = []
const acquireArt = () => new Promise<void>(res => { const go = () => { artSlots++; res() }; if (artSlots < 3) go(); else artWaiters.push(go) })
const releaseArt = () => { artSlots--; artWaiters.shift()?.() }

async function makeSmall(id: string): Promise<Blob | undefined> {
  const full = await loadArt(id); if (!full) return undefined
  try {
    const bmp = await createImageBitmap(full)
    const sc = Math.min(1, 160 / Math.max(bmp.width, bmp.height))
    const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * sc)), Math.max(1, Math.round(bmp.height * sc)))
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close()
    const small = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
    void saveArtSmall(id, small)
    return small
  } catch { return full }
}

export function artworkUrl(id: string, size: 'sm' | 'full' = 'sm'): Promise<string | null> {
  const key = `${id}|${size}`
  if (artUrls.has(key)) return Promise.resolve(artUrls.get(key) ?? null)
  const pending = artInflight.get(key); if (pending) return pending
  const p = (async () => {
    await acquireArt()
    try {
      const blob = size === 'full' ? await loadArt(id) : ((await loadArtSmall(id)) ?? (await makeSmall(id)))
      const url = blob ? URL.createObjectURL(blob) : null
      artUrls.set(key, url)
      return url
    } finally { releaseArt() }
  })().finally(() => artInflight.delete(key))
  artInflight.set(key, p)
  return p
}
const forgetArt = (id: string) => { for (const k of [`${id}|sm`, `${id}|full`]) { const u = artUrls.get(k); if (u) URL.revokeObjectURL(u); artUrls.delete(k) } }

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
    if (!blob) throw new Error(translate("Audio file missing from storage"))
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    decoded.set(id, buf)
    while (decoded.size > 3) decoded.delete(decoded.keys().next().value as string)
    return buf
  })().finally(() => inflight.delete(id))
  inflight.set(id, p)
  return p
}

/**
 * Loudness is only needed when normalization is on. It is measured once per track on a worker (≤2 min excerpt from the middle),
 * then stored with the track, so playback never blocks on a full-file analysis.
 */
async function ensureLoudness(id: string, buf: AudioBuffer) {
  const t = trackById.peek().get(id)
  if (!t || t.lufs !== undefined) return
  const ch = excerptChannels(Array.from({ length: Math.min(buf.numberOfChannels, 2) }, (_, i) => buf.getChannelData(i)), buf.sampleRate, 120)
  const m = await measureLoudnessAsync(ch, buf.sampleRate)
  const cur = trackById.peek().get(id)
  if (!cur) return
  const next = { ...cur, lufs: m.lufs, peak: m.peak }
  tracks.value = tracks.peek().map(x => (x.id === id ? next : x))
  await saveTrack(next)
}

/** Decode without keeping the PCM around (used by export so only one track is resident at a time). */
export async function decodeTrackUncached(id: string, ctx: BaseAudioContext): Promise<AudioBuffer> {
  const hit = decoded.get(id)
  if (hit) return hit
  const blob = await loadFile(id)
  if (!blob) throw new Error(translate("Audio file missing from storage"))
  return ctx.decodeAudioData(await blob.arrayBuffer())
}

let engine: PlaybackEngine | null = null
/** Sample rate if the audio engine already exists (reading it must not create one). */
export const engineSampleRate = () => engine?.ctx.sampleRate

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
  if (!blob) return notify(translate("Audio file missing from storage"))
  const url = await artworkUrl(id, 'full')
  try { await getBook().load(blob, { id, title: t.title, artist: t.artist, album: t.album, artwork: url ?? undefined }, startAt ?? positions.peek()[id] ?? 0, settings.peek().bookRate) }
  catch (e) { notify(e instanceof Error ? translate(e.message) : translate("Playback failed")) }
}

export async function addBookmark(trackId: string, time: number, label?: string) {
  const t = trackById.peek().get(trackId)
  const b: Bookmark = { id: crypto.randomUUID(), trackId, time, label: label || `${t?.title ?? translate("Bookmark")}`, createdAt: Date.now() }
  bookmarks.value = [...bookmarks.peek(), b]
  await saveBookmarks(bookmarks.peek())
  notify(translate("Bookmark added"))
}
export async function removeBookmark(id: string) { bookmarks.value = bookmarks.peek().filter(b => b.id !== id); await saveBookmarks(bookmarks.peek()) }
export async function playBookmark(b: Bookmark) {
  const t = trackById.peek().get(b.trackId); if (!t) return notify(translate("That song was deleted"))
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
  forgetArt(id)
  await deleteArtSmall(id)
  tracks.value = [...tracks.peek()] // refresh listeners
}

export function toPlayItem(t: StoredTrack): PlayItem {
  return {
    id: t.id, title: t.title, artist: t.artist, album: t.album,
    load: async ctx => {
      const buf = await decodeTrack(t.id, ctx)
      if (settings.peek().normalize) await ensureLoudness(t.id, buf).catch(() => {})
      return buf
    },
    gainFor: () => {
      if (!settings.peek().normalize) return 1
      const cur = trackById.peek().get(t.id)
      return cur?.lufs !== undefined && cur.peak !== undefined && Number.isFinite(cur.lufs) ? gainForTarget(cur.lufs, settings.peek().targetLufs, cur.peak) : 1
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
    id, title: m?.title ?? node.title, artist: m?.artist ?? translate("Unknown Artist"), album: m?.album ?? translate("Unknown Album"), duration: m?.duration ?? 0,
    trackNo: m?.trackNo, year: m?.year, genre: m?.genre, addedAt: Date.now(), playCount: 0, favorite: false, fileName: node.fileName ?? node.title,
  }
  remoteLoaders.set(id, async () => (await import('./connect/sources')).createAdapter(source).blob(node))
  return t
}

/** Stream remote tracks through the normal player (downloads each file into memory, then decodes). */
export async function playRemote(source: Source, nodes: RemoteNode[], start = 0) {
  const list = nodes.map(n => remoteTrack(source, n))
  ephemeral.value = list
  await playTracks(list, start)
}

export async function downloadRemote(source: Source, nodes: RemoteNode[], onProgress?: (d: number, t: number) => void) {
  const adapter = (await import('./connect/sources')).createAdapter(source)
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
  try { await getBook().loadStream(url, { id: `stream:${url}`, title: name, artist: translate("Internet radio"), album: url }) }
  catch { notify(translate("Could not play that stream. Browsers need https:// streams.")) }
}

/** Hide the song at once and delete for real after the undo window; the record is gone from storage immediately so it can't reappear. */
export function deleteTrackWithUndo(id: string) {
  const t = trackById.peek().get(id); if (!t) return
  tracks.value = tracks.peek().filter(x => x.id !== id)
  void deleteTrackRecord(id)
  notifyUndo(translate('Deleted “{title}”', { title: t.title }),
    () => { tracks.value = [...tracks.peek(), t]; void saveTrack(t) },
    () => { void deleteTrackFiles(id); playlists.value = playlists.peek().map(p => ({ ...p, trackIds: p.trackIds.filter(x => x !== id) })); void savePlaylists(playlists.peek()) })
}

export async function removeTrack(id: string) {
  tracks.value = tracks.value.filter(t => t.id !== id)
  playlists.value = playlists.value.map(p => ({ ...p, trackIds: p.trackIds.filter(x => x !== id) }))
  await Promise.all([deleteTrack(id), savePlaylists(playlists.value)])
}

export async function importAudio(files: File[], onProgress?: (d: number, t: number) => void) {
  const { importFiles } = await import('./library/importer')
  const res = await importFiles(files, tracks.value, onProgress)
  tracks.value = [...tracks.value, ...res.added]
  if (res.failed.length) notify(translate("{length} file(s) failed: {name} — {reason}", { length: res.failed.length, name: res.failed[0]!.name, reason: res.failed[0]!.reason }))
  else if (res.added.length) notify(translate('addedTracks', { count: res.added.length }))
  return res
}

export async function createPlaylist(name: string, trackIds: string[] = []) {
  const now = Date.now()
  const p: Playlist = { id: crypto.randomUUID(), name, trackIds, updatedAt: now, createdAt: now }
  playlists.value = [...playlists.value, p]
  await savePlaylists(playlists.value)
  return p
}

/** Queue songs after the current one ('next') or at the end ('later'); starts playing if nothing is. */
export async function enqueue(list: StoredTrack[], where: 'next' | 'later') {
  if (!list.length) return
  const e = getEngine()
  if (e.getState().status === 'idle' || !queueIds.peek().length || bookState.peek().status !== 'idle') { await playTracks(list, 0); return }
  const at = where === 'next' ? e.getState().index + 1 : queueIds.peek().length
  const ids = [...queueIds.peek()]
  ids.splice(at, 0, ...list.map(t => t.id))
  queueIds.value = ids
  e.insertItems(list.map(toPlayItem), where)
  notify(translate(where === 'next' ? 'playingNextSongs' : 'queuedSongs', { count: list.length }))
}

export async function setPlaylistArtwork(id: string, file: Blob) { await setArtwork(`pl:${id}`, file); await updatePlaylist(id, { customArt: true }) }
export async function removePlaylistArtwork(id: string) { await updatePlaylist(id, { customArt: false }) }
export async function updatePlaylist(id: string, patch: Partial<Playlist>) {
  playlists.value = playlists.value.map(p => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p))
  await savePlaylists(playlists.value)
}
/** Remove playlist entries immediately, with an Undo that restores the previous order. */
export function removeFromPlaylistWithUndo(id: string, trackIds: string[]) {
  const p = playlists.peek().find(x => x.id === id); if (!p) return
  const before = p.trackIds
  void updatePlaylist(id, { trackIds: before.filter(x => !trackIds.includes(x)) })
  notifyUndo(translate('removedFromPlaylist', { count: trackIds.length }), () => { void updatePlaylist(id, { trackIds: before }) }, () => {})
}
export function deletePlaylistWithUndo(ps: Playlist[]) {
  const ids = new Set(ps.map(p => p.id))
  playlists.value = playlists.peek().filter(p => !ids.has(p.id)); void savePlaylists(playlists.peek())
  notifyUndo(ps.length === 1 ? translate('Deleted “{name}”', { name: ps[0]!.name }) : translate('deletedPlaylists', { count: ps.length }), () => { playlists.value = [...playlists.peek(), ...ps]; void savePlaylists(playlists.peek()) }, () => {})
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

export async function reloadAll() {
  const [t, p, a, s, bm, pos] = await Promise.all([loadTracks(), loadPlaylists(), loadArrangements(), loadSettings(), loadBookmarks(), loadPositions()])
  bookmarks.value = bm; positions.value = pos
  tracks.value = t; playlists.value = p; arrangements.value = a; settings.value = s
  sources.value = await loadSources()
}

export async function boot() {
  await reloadAll()
  if (/[?&]code=/.test(location.search) || sources.peek().some(x => x.kind === 'dropbox' || x.kind === 'gdrive' || x.kind === 'onedrive')) {
    void import('./connect/cloud').then(async c => {
      c.setSourceSaver(saveSource)
      try { const s = await c.finishAuth(); if (s) { await saveSource(s); notify(translate('Connected to {name}', { name: s.name })) } }
      catch (e) { notify(e instanceof Error ? translate(e.message) : translate('Sign-in failed')) }
    })
  }
  void navigator.storage?.persist?.().catch(() => {}) // best effort; never block startup on it
  ready.value = true
  // housekeeping off the critical path
  setTimeout(() => { void findOrphans().then(ids => Promise.all(ids.map(deleteTrackFiles))).catch(() => {}) }, 4000)
}
export { makeTransition }
