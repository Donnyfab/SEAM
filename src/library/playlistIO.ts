import type { Playlist } from './store'

export interface PlaylistTrack {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  fileName?: string
}

export interface PlaylistEntry {
  title?: string
  artist?: string
  fileName?: string
  duration?: number
}

const validDuration = (n: number): number => Number.isFinite(n) && n >= 0 ? n : 0
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const singleLine = (s: string): string => s.replace(/[\r\n]+/g, ' ')
const basename = (s: string): string => s.split(/[\\/]/).pop() ?? s
const isUrl = (s: string): boolean => /^(?:[a-z][a-z\d+.-]*:\/\/|\/\/|(?:data|mailto):)/i.test(s)

export function playlistDuration(p: Playlist, byId: ReadonlyMap<string, { duration: number }>): number {
  return p.trackIds.reduce((total, id) => total + validDuration(byId.get(id)?.duration ?? 0), 0)
}

/** Whole seconds below a minute; whole hours/minutes thereafter. */
export function formatTotal(seconds: number): string {
  const total = Math.floor(validDuration(seconds))
  const unit = (n: number, label: string): string => `${n} ${label}${n === 1 ? '' : 's'}`
  if (total < 60) return unit(total, 'second')
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return unit(minutes, 'minute')
  return [unit(Math.floor(minutes / 60), 'hour'), minutes % 60 ? unit(minutes % 60, 'minute') : ''].filter(Boolean).join(' ')
}

export function sortPlaylists(
  list: readonly Playlist[], key: 'name' | 'created' | 'updated' | 'duration' | 'count',
  dir: 'asc' | 'desc', byId: ReadonlyMap<string, { duration: number }>,
): Playlist[] {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
  const value = (p: Playlist): number => {
    switch (key) {
      case 'created': return p.createdAt ?? p.updatedAt
      case 'updated': return p.updatedAt
      case 'duration': return playlistDuration(p, byId)
      case 'count': return p.trackIds.length
      default: return 0
    }
  }
  return list.map((p, index) => ({ p, index })).sort((a, b) => {
    const comparison = key === 'name' ? collator.compare(a.p.name, b.p.name) : value(a.p) - value(b.p)
    return (dir === 'asc' ? comparison : -comparison) || a.index - b.index
  }).map(({ p }) => p)
}

export function searchPlaylists(
  list: readonly Playlist[], query: string, byId: ReadonlyMap<string, Pick<PlaylistTrack, 'title' | 'artist'>>,
): Playlist[] {
  const terms = fold(query).split(/\s+/).filter(Boolean)
  return list.filter(p => {
    const text = fold([p.name, ...p.trackIds.flatMap(id => {
      const t = byId.get(id)
      return t ? [t.title, t.artist] : []
    })].join(' '))
    return terms.every(term => text.includes(term))
  })
}

export function exportM3U(p: Playlist, byId: ReadonlyMap<string, PlaylistTrack>): string {
  const lines = ['#EXTM3U', `#PLAYLIST:${singleLine(p.name)}`]
  for (const id of p.trackIds) {
    const t = byId.get(id)
    if (t) lines.push(`#EXTINF:${validDuration(t.duration)},${singleLine(t.artist)} - ${singleLine(t.title)}`, singleLine(t.fileName || t.title))
  }
  return lines.join('\n') + '\n'
}

export function exportSeamJson(p: Playlist, byId: ReadonlyMap<string, PlaylistTrack>): string {
  return JSON.stringify({ format: 'seam-playlist', version: 1, name: p.name, tracks: p.trackIds.flatMap(id => {
    const t = byId.get(id)
    return t ? [{ title: t.title, artist: t.artist, album: t.album, duration: validDuration(t.duration), fileName: t.fileName ?? '' }] : []
  }) }, null, 2)
}

function metadata(label: string, length?: string): PlaylistEntry {
  const entry: PlaylistEntry = {}
  const separator = label.indexOf(' - ')
  if (separator >= 0) {
    entry.artist = label.slice(0, separator).trim()
    entry.title = label.slice(separator + 3).trim()
  } else if (label.trim()) entry.title = label.trim()
  if (length?.trim() && Number.isFinite(Number(length)) && Number(length) >= 0) entry.duration = Number(length)
  return entry
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Invalid/unsupported JSON and unsupported extensions throw; malformed text rows are ignored. */
export function parsePlaylistFile(name: string, text: string): { name: string; entries: PlaylistEntry[] } {
  const extension = name.split('.').pop()?.toLowerCase()
  let playlistName = basename(name).replace(/\.[^.]+$/, '')
  const entries: PlaylistEntry[] = []
  const clean = text.replace(/^\uFEFF/, '')
  if (extension === 'json') {
    const data: unknown = JSON.parse(clean)
    if (!record(data) || data.format !== 'seam-playlist' || data.version !== 1 || !Array.isArray(data.tracks)) throw new Error('Invalid SEAM playlist')
    if (typeof data.name === 'string' && data.name.trim()) playlistName = data.name
    for (const t of data.tracks) {
      if (!record(t)) continue
      const entry: PlaylistEntry = {}
      for (const key of ['title', 'artist', 'fileName'] as const) {
        if (typeof t[key] === 'string' && t[key]) entry[key] = t[key]
      }
      if (typeof t.duration === 'number' && Number.isFinite(t.duration) && t.duration >= 0) entry.duration = t.duration
      if (entry.title || entry.fileName) entries.push(entry)
    }
  } else if (extension === 'm3u' || extension === 'm3u8') {
    let pending: PlaylistEntry = {}
    for (const raw of clean.split(/\r\n?|\n/)) {
      const line = raw.trim()
      if (!line) continue
      if (/^#PLAYLIST:/i.test(line)) playlistName = line.slice(10).trim() || playlistName
      else if (/^#EXTINF:/i.test(line)) {
        const comma = line.indexOf(',')
        pending = comma < 0 ? {} : metadata(line.slice(comma + 1), line.slice(8, comma))
      } else if (!line.startsWith('#')) {
        if (!isUrl(line)) entries.push({ ...pending, fileName: basename(line) })
        pending = {}
      }
    }
  } else if (extension === 'pls') {
    const rows = new Map<number, { file?: string; title?: string; length?: string }>()
    for (const line of clean.split(/\r\n?|\n/)) {
      const match = /^\s*(File|Title|Length)(\d+)\s*=(.*)$/i.exec(line)
      if (!match || Number(match[2]) < 1) continue
      const index = Number(match[2])
      const row = rows.get(index) ?? {}
      const key = match[1]?.toLowerCase()
      const value = match[3]?.trim() ?? ''
      if (key === 'file') row.file = value
      else if (key === 'title') row.title = value
      else row.length = value
      rows.set(index, row)
    }
    for (const [, row] of [...rows].sort(([a], [b]) => a - b)) {
      if (row.file && !isUrl(row.file)) entries.push({ ...metadata(row.title ?? '', row.length), fileName: basename(row.file) })
    }
  } else throw new Error('Unsupported playlist file')
  return { name: playlistName, entries }
}

export function matchEntries(entries: readonly PlaylistEntry[], tracks: readonly PlaylistTrack[]): { ids: string[]; unmatched: string[] } {
  const files = new Map<string, PlaylistTrack>()
  const labels = new Map<string, PlaylistTrack>()
  const titles = new Map<string, PlaylistTrack[]>()
  for (const t of tracks) {
    if (t.fileName && !files.has(t.fileName.toLowerCase())) files.set(t.fileName.toLowerCase(), t)
    const label = `${t.artist} - ${t.title}`.toLowerCase()
    if (!labels.has(label)) labels.set(label, t)
    const title = t.title.toLowerCase()
    titles.set(title, [...(titles.get(title) ?? []), t])
  }
  const ids: string[] = []
  const unmatched: string[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    let track = entry.fileName ? files.get(entry.fileName.toLowerCase()) : undefined
    if (!track && entry.artist && entry.title) track = labels.get(`${entry.artist} - ${entry.title}`.toLowerCase())
    if (!track && entry.title) {
      const candidates = titles.get(entry.title.toLowerCase())
      if (candidates?.length === 1) track = candidates[0]
    }
    if (track) {
      if (!seen.has(track.id)) { ids.push(track.id); seen.add(track.id) }
    } else unmatched.push(entry.artist && entry.title ? `${entry.artist} - ${entry.title}` : entry.title || entry.fileName || '')
  }
  return { ids, unmatched }
}

/** Indices are truncated and clamped to the existing array bounds. NaN means zero. */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const result = [...arr]
  if (!result.length) return result
  const clamp = (n: number): number => Math.max(0, Math.min(result.length - 1, Number.isNaN(n) ? 0 : Math.trunc(n)))
  const source = clamp(from)
  const target = clamp(to)
  const removed = result.splice(source, 1)
  result.splice(target, 0, ...removed)
  return result
}
