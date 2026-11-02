import { createStore, del, get, getMany, keys, set, setMany, type UseStore } from 'idb-keyval'
import type { Track } from './model'
import type { Arrangement } from '../core/arrangement'

const tracksDB: UseStore = createStore('seam-tracks', 'kv')
const filesDB: UseStore = createStore('seam-files', 'kv')
const artDB: UseStore = createStore('seam-art', 'kv')
const docsDB: UseStore = createStore('seam-docs', 'kv')

export interface StoredTrack extends Track { fingerprint?: string; fileName?: string; sampleRate?: number; codec?: string; lufs?: number; peak?: number; kind?: 'music' | 'audiobook'; lyrics?: string; comment?: string }
export interface Playlist { id: string; name: string; trackIds: string[]; updatedAt: number }
import { defaultFx, type FxSettings } from '../audio/presets'
export interface Settings { language: 'auto' | 'en' | 'es' | 'fr' | 'de'; crossfade: number; repeat: 'off' | 'all' | 'one'; fx: FxSettings; normalize: boolean; targetLufs: number; bookRate: number; skipBack: number; skipForward: number; visualizer: 'bars' | 'wave' | 'radial' | 'off'; textScale: number; reduceMotion: boolean; highContrast: boolean; lockAfter: number }
export const defaultSettings: Settings = { language: 'auto', crossfade: 0, repeat: 'off', fx: defaultFx, normalize: false, targetLufs: -14, bookRate: 1, skipBack: 15, skipForward: 30, visualizer: 'bars', textScale: 1, reduceMotion: false, highContrast: false, lockAfter: 60 }

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

export interface Bookmark { id: string; trackId: string; time: number; label: string; createdAt: number }
export const loadBookmarks = async () => (await get<Bookmark[]>('bookmarks', docsDB)) ?? []
export const saveBookmarks = (b: Bookmark[]) => set('bookmarks', b, docsDB)
/** Last listening position per track (seconds), used for audiobooks and long tracks. */
export const loadPositions = async () => (await get<Record<string, number>>('positions', docsDB)) ?? {}
export const savePositions = (p: Record<string, number>) => set('positions', p, docsDB)
export async function loadAllDocs() { return { playlists: await loadPlaylists(), arrangements: await loadArrangements(), settings: await loadSettings(), bookmarks: await loadBookmarks(), positions: await loadPositions() } }

import type { Source } from '../connect/sources'
export const loadSources = async () => (await get<Source[]>('sources', docsDB)) ?? []
export const saveSources = (s: Source[]) => set('sources', s, docsDB)

import type { PasscodeRecord } from '../security/passcode'
export const loadPasscode = () => get<PasscodeRecord>('passcode', docsDB)
export const savePasscode = (r: PasscodeRecord | null) => (r ? set('passcode', r, docsDB) : del('passcode', docsDB))

/** Raw access for backup/restore. */
export const rawStores = { tracksDB, filesDB, artDB, docsDB }
export const loadPlaylists = async () => (await get<Playlist[]>('playlists', docsDB)) ?? []
export const savePlaylists = (p: Playlist[]) => set('playlists', p, docsDB)
export const loadArrangements = async () => (await get<Arrangement[]>('arrangements', docsDB)) ?? []
export const saveArrangements = (a: Arrangement[]) => set('arrangements', a, docsDB)
export const loadSettings = async () => ({ ...defaultSettings, ...((await get<Partial<Settings>>('settings', docsDB)) ?? {}) })
export const saveSettings = (s: Settings) => set('settings', s, docsDB)
