import { createStore, del, get, getMany, keys, set, setMany, type UseStore } from 'idb-keyval'
import type { Track } from './model'
import type { Arrangement } from '../core/arrangement'

const tracksDB: UseStore = createStore('seam-tracks', 'kv')
const filesDB: UseStore = createStore('seam-files', 'kv')
const artDB: UseStore = createStore('seam-art', 'kv')
const docsDB: UseStore = createStore('seam-docs', 'kv')

export interface StoredTrack extends Track { fingerprint?: string; fileName?: string; sampleRate?: number; codec?: string }
export interface Playlist { id: string; name: string; trackIds: string[]; updatedAt: number }
export interface Settings { crossfade: number; repeat: 'off' | 'all' | 'one' }
export const defaultSettings: Settings = { crossfade: 0, repeat: 'off' }

export async function loadTracks(): Promise<StoredTrack[]> {
  const ks = await keys(tracksDB)
  return (await getMany<StoredTrack>(ks, tracksDB)).filter((t): t is StoredTrack => !!t)
}
export const saveTrack = (t: StoredTrack) => set(t.id, t, tracksDB)
export const saveTracks = (ts: StoredTrack[]) => setMany(ts.map(t => [t.id, t]), tracksDB)
export const saveFile = (id: string, blob: Blob) => set(id, blob, filesDB)
export const loadFile = (id: string) => get<Blob>(id, filesDB)
export const saveArt = (id: string, blob: Blob) => set(id, blob, artDB)
export const loadArt = (id: string) => get<Blob>(id, artDB)

export async function deleteTrack(id: string) {
  await Promise.all([del(id, tracksDB), del(id, filesDB), del(id, artDB)])
}

export const loadPlaylists = async () => (await get<Playlist[]>('playlists', docsDB)) ?? []
export const savePlaylists = (p: Playlist[]) => set('playlists', p, docsDB)
export const loadArrangements = async () => (await get<Arrangement[]>('arrangements', docsDB)) ?? []
export const saveArrangements = (a: Arrangement[]) => set('arrangements', a, docsDB)
export const loadSettings = async () => ({ ...defaultSettings, ...((await get<Partial<Settings>>('settings', docsDB)) ?? {}) })
export const saveSettings = (s: Settings) => set('settings', s, docsDB)
