import { set } from 'idb-keyval'
import { buildManifest, mergeById, parseManifest, BackupError } from './backup'
import { loadArrangements, loadArt, loadBookmarks, loadFile, loadPlaylists, loadPositions, loadSettings, loadTracks, rawStores, saveArrangements, saveArt, saveBookmarks, saveFile, savePlaylists, savePositions, saveTrack, type StoredTrack } from './store'

const MAGIC = 'SEAMBAK1'
interface FileEntry { id: string; kind: 'audio' | 'art'; offset: number; length: number; type: string }

/**
 * Backup container: "SEAMBAK1" | u32 header length | JSON header | file bodies.
 * Bodies are Blob slices, so a multi-GB library is assembled without loading it into memory.
 */
export async function createBackup(onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const tracks = await loadTracks()
  const manifest = buildManifest({ tracks, playlists: await loadPlaylists(), arrangements: await loadArrangements(), settings: await loadSettings(), bookmarks: await loadBookmarks() })
  const positions = await loadPositions()
  const files: FileEntry[] = [], bodies: Blob[] = []
  let offset = 0, done = 0
  for (const t of tracks) {
    for (const kind of ['audio', 'art'] as const) {
      const b = await (kind === 'audio' ? loadFile(t.id) : loadArt(t.id))
      if (b) { files.push({ id: t.id, kind, offset, length: b.size, type: b.type }); bodies.push(b); offset += b.size }
    }
    onProgress?.(++done, tracks.length)
  }
  const header = new TextEncoder().encode(JSON.stringify({ manifest, positions, files }))
  const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, header.length, true)
  return new Blob([MAGIC, len, header, ...bodies], { type: 'application/octet-stream' })
}

export interface RestoreResult { tracks: number; playlists: number; arrangements: number; bookmarks: number }

export async function restoreBackup(file: Blob, strategy: 'keep' | 'replace', onProgress?: (done: number, total: number) => void): Promise<RestoreResult> {
  const magic = await file.slice(0, 8).text()
  if (magic !== MAGIC) throw new BackupError('This is not a SEAM backup file')
  const hl = new DataView(await file.slice(8, 12).arrayBuffer()).getUint32(0, true)
  if (hl > 64 * 1024 * 1024) throw new BackupError('Backup header is corrupt')
  const header = JSON.parse(await file.slice(12, 12 + hl).text()) as { manifest: unknown; positions?: Record<string, number>; files: FileEntry[] }
  const manifest = parseManifest(JSON.stringify(header.manifest))
  const base = 12 + hl
  const existing = await loadTracks()
  const have = new Set(existing.map(t => t.id))
  const tracks = manifest.tracks as StoredTrack[]
  let n = 0
  for (const t of tracks) {
    if (have.has(t.id) && strategy === 'keep') { onProgress?.(++n, tracks.length); continue }
    for (const f of header.files.filter(x => x.id === t.id)) {
      const body = file.slice(base + f.offset, base + f.offset + f.length, f.type)
      await (f.kind === 'audio' ? saveFile(t.id, body) : saveArt(t.id, body))
    }
    await saveTrack(t)
    onProgress?.(++n, tracks.length)
  }
  const pl = mergeById(await loadPlaylists(), manifest.playlists as { id: string }[], strategy)
  const ar = mergeById(await loadArrangements(), manifest.arrangements as { id: string }[], strategy)
  const bm = mergeById(await loadBookmarks(), manifest.bookmarks as { id: string }[], strategy)
  await savePlaylists(pl as never); await saveArrangements(ar as never); await saveBookmarks(bm as never)
  await savePositions({ ...(strategy === 'keep' ? { ...header.positions, ...(await loadPositions()) } : { ...(await loadPositions()), ...header.positions }) })
  if (strategy === 'replace') await set('settings', manifest.settings, rawStores.docsDB)
  return { tracks: tracks.length, playlists: manifest.playlists.length, arrangements: manifest.arrangements.length, bookmarks: manifest.bookmarks.length }
}
