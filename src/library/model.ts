export interface Track {
  id: string
  title: string
  artist: string
  albumArtist?: string
  album: string
  genre?: string
  composer?: string
  trackNo?: number
  year?: number
  duration: number
  addedAt: number
  playCount: number
  lastPlayedAt?: number
  favorite: boolean
}

export type TrackSortKey = 'title' | 'artist' | 'album' | 'addedAt' | 'duration' | 'playCount'
export interface TrackGroup {
  key: string
  tracks: Track[]
  duration: number
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export function searchTracks(tracks: readonly Track[], query: string): Track[] {
  const terms = normalize(query).split(/\s+/u).filter(Boolean)
  return tracks.filter(track => {
    const fields = [track.title, track.artist, track.album, track.genre ?? '', track.composer ?? ''].map(normalize)
    return terms.every(term => fields.some(field => field.includes(term)))
  })
}

export function sortTracks(tracks: readonly Track[], key: TrackSortKey, dir: 'asc' | 'desc' = 'asc'): Track[] {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
  const direction = dir === 'asc' ? 1 : -1
  return [...tracks].sort((a, b) => {
    const left = a[key]
    const right = b[key]
    return direction * (typeof left === 'number' && typeof right === 'number'
      ? left - right
      : collator.compare(String(left), String(right)))
  })
}

function groupTracks(tracks: readonly Track[], keyOf: (track: Track) => string): TrackGroup[] {
  const groups = new Map<string, TrackGroup>()
  for (const track of tracks) {
    const key = keyOf(track)
    let group = groups.get(key)
    if (!group) {
      group = { key, tracks: [], duration: 0 }
      groups.set(key, group)
    }
    group.tracks.push(track)
    group.duration += track.duration
  }
  return [...groups.values()]
}

/** Album keys are JSON-encoded [albumArtist || artist, album] pairs. */
export function groupAlbums(tracks: readonly Track[]): TrackGroup[] {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
  const groups = groupTracks(tracks, track => JSON.stringify([track.albumArtist || track.artist, track.album]))
  for (const group of groups) {
    group.tracks.sort((a, b) => {
      if (a.trackNo === undefined) return b.trackNo === undefined ? 0 : 1
      if (b.trackNo === undefined) return -1
      return a.trackNo - b.trackNo
    })
  }
  return groups.sort((a, b) => {
    const left = a.tracks[0]!
    const right = b.tracks[0]!
    return collator.compare(left.albumArtist || left.artist, right.albumArtist || right.artist)
      || collator.compare(left.album, right.album)
  })
}

export function groupArtists(tracks: readonly Track[]): TrackGroup[] {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
  return groupTracks(tracks, track => track.artist).sort((a, b) => collator.compare(a.key, b.key))
}

export function groupGenres(tracks: readonly Track[]): TrackGroup[] {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
  return groupTracks(tracks, track => track.genre?.trim() || 'Unknown Genre')
    .sort((a, b) => collator.compare(a.key, b.key))
}

export function unplayed(tracks: readonly Track[]): Track[] {
  return tracks.filter(track => track.playCount === 0)
}

/** Most recently played first; tracks without a playback timestamp are excluded. */
export function recents(tracks: readonly Track[], limit: number): Track[] {
  if (Number.isNaN(limit) || limit <= 0) return []
  return tracks.filter((track): track is Track & { lastPlayedAt: number } => track.lastPlayedAt !== undefined)
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, Math.floor(limit))
}
