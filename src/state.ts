import { signal, computed, effect } from '@preact/signals'
import { PlaybackEngine, type EngineState, type PlayItem } from './audio/engine'
import { makeTransition } from './core/crossfade'
import { shuffleUpcoming, makeQueue } from './core/queue'
import { importFiles } from './library/importer'
import {
  defaultSettings, deleteTrack, loadArrangements, loadArt, loadFile, loadPlaylists, loadSettings, loadTracks,
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
export const toast = signal<string | null>(null)
/** id of the arrangement currently being played from Studio, else null */
export const playingArrangement = signal<string | null>(null)

export const trackById = computed(() => new Map(tracks.value.map(t => [t.id, t])))

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
    const blob = await loadFile(id)
    if (!blob) throw new Error('Audio file missing from storage')
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    decoded.set(id, buf)
    while (decoded.size > 3) decoded.delete(decoded.keys().next().value as string)
    return buf
  })().finally(() => inflight.delete(id))
  inflight.set(id, p)
  return p
}

let engine: PlaybackEngine | null = null
export function getEngine(): PlaybackEngine {
  if (engine) return engine
  engine = new PlaybackEngine()
  engine.subscribe(s => { engineState.value = s })
  return engine
}

export function toPlayItem(t: StoredTrack): PlayItem {
  return {
    id: t.id, title: t.title, artist: t.artist, album: t.album,
    load: ctx => decodeTrack(t.id, ctx),
  }
}

/** Replace the queue and start playback (global crossfade applies; Studio overrides this per transition). */
export async function playTracks(list: StoredTrack[], start = 0) {
  if (!list.length) return
  const e = getEngine()
  let ids = list.map(t => t.id)
  let idx = start
  if (shuffle.value) {
    const q = shuffleUpcoming(makeQueue(ids, start))
    ids = q.items
  }
  queueIds.value = ids
  playingArrangement.value = null
  e.transitionAfter = undefined
  e.crossfade = settings.value.crossfade
  e.repeat = settings.value.repeat
  e.setItems(ids.map(id => toPlayItem(trackById.value.get(id)!)))
  await e.play(idx)
}

export async function toggleFavorite(id: string) {
  const t = trackById.value.get(id); if (!t) return
  const next = { ...t, favorite: !t.favorite }
  tracks.value = tracks.value.map(x => (x.id === id ? next : x))
  await saveTrack(next)
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
  if (engine) { engine.crossfade = settings.value.crossfade; engine.repeat = settings.value.repeat }
}

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
  const [t, p, a, s] = await Promise.all([loadTracks(), loadPlaylists(), loadArrangements(), loadSettings()])
  tracks.value = t; playlists.value = p; arrangements.value = a; settings.value = s
  try { await navigator.storage?.persist?.() } catch { /* best effort */ }
  ready.value = true
}
export { makeTransition }
