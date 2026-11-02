import { describe, expect, it } from 'vitest'
import { groupAlbums, groupArtists, groupGenres, recents, searchTracks, sortTracks, unplayed } from '../src/library/model'
import type { Track, TrackSortKey } from '../src/library/model'

function track(id: string, overrides: Partial<Track> = {}): Track {
  return { id, title: id, artist: 'Artist', album: 'Album', duration: 60, addedAt: 0, playCount: 0, favorite: false, ...overrides }
}
const ids = (tracks: readonly Track[]) => tracks.map(t => t.id)

describe('searchTracks', () => {
  const tracks = [track('a', { title: 'Café Moon', artist: 'Beyoncé', album: 'Été', genre: 'Soul', composer: 'Frédéric' }), track('b')]
  it('matches every term across all searchable fields, ignoring case and accents', () => {
    expect(ids(searchTracks(tracks, ' CAFE\tBEYONCE\nEtE soul frederic '))).toEqual(['a'])
    expect(searchTracks(tracks, 'cafe absent')).toEqual([])
    expect(ids(searchTracks(tracks, 'cafe\u0301'))).toEqual(['a'])
  })
  it('handles empty queries, missing optional fields, and empty libraries', () => {
    expect(searchTracks(tracks, ' \n ')).toEqual(tracks)
    expect(searchTracks(tracks, '')).not.toBe(tracks)
    expect(searchTracks([], 'moon')).toEqual([])
    expect(searchTracks([track('x', { albumArtist: 'Hidden' })], 'hidden')).toEqual([])
  })
})

describe('sortTracks', () => {
  it.each<TrackSortKey>(['title', 'artist', 'album'])('uses natural text ordering for %s in both directions', key => {
    const tracks = [track('10', { [key]: 'Item 10' }), track('2', { [key]: 'item 2' })]
    expect(ids(sortTracks(tracks, key, 'asc'))).toEqual(['2', '10'])
    expect(ids(sortTracks(tracks, key, 'desc'))).toEqual(['10', '2'])
    expect(ids(tracks)).toEqual(['10', '2'])
  })
  it.each<TrackSortKey>(['addedAt', 'duration', 'playCount'])('sorts %s numerically', key => {
    const tracks = [track('high', { [key]: 100 }), track('low', { [key]: 2 })]
    expect(ids(sortTracks(tracks, key))).toEqual(['low', 'high'])
    expect(ids(sortTracks(tracks, key, 'desc'))).toEqual(['high', 'low'])
  })
  it('keeps equal values stable and handles empty input', () => {
    expect(ids(sortTracks([track('a', { title: 'Été' }), track('b', { title: 'ete' })], 'title'))).toEqual(['a', 'b'])
    expect(sortTracks([], 'title')).toEqual([])
  })
})

describe('groups', () => {
  it('groups compilations by album artist and orders numbered tracks before missing numbers', () => {
    const tracks = [
      track('missing', { artist: 'Guest', albumArtist: 'Various', duration: 10 }),
      track('10', { albumArtist: 'Various', trackNo: 10, duration: 20 }),
      track('2', { albumArtist: 'Various', trackNo: 2, duration: 30 }),
      track('solo', { artist: 'Alpha', albumArtist: '' }),
    ]
    const groups = groupAlbums(tracks)
    expect(groups.map(g => g.key)).toEqual([JSON.stringify(['Alpha', 'Album']), JSON.stringify(['Various', 'Album'])])
    expect(ids(groups[1]!.tracks)).toEqual(['2', '10', 'missing'])
    expect(groups[1]!.duration).toBe(60)
    expect(ids(tracks)).toEqual(['missing', '10', '2', 'solo'])
  })
  it('keeps different artists and delimiter-containing album pairs separate', () => {
    const tracks = [track('a', { artist: 'A - B', album: 'C' }), track('b', { artist: 'A', album: 'B - C' }), track('c', { artist: 'Other', album: 'C' })]
    expect(groupAlbums(tracks)).toHaveLength(3)
  })
  it('naturally sorts albums within an artist', () => {
    expect(groupAlbums([track('a', { album: 'Album 10' }), track('b', { album: 'Album 2' })]).map(g => g.key))
      .toEqual([JSON.stringify(['Artist', 'Album 2']), JSON.stringify(['Artist', 'Album 10'])])
  })
  it('groups artists by performing artist and sums durations', () => {
    const groups = groupArtists([track('a', { artist: 'Artist 10' }), track('b', { artist: 'Artist 2', albumArtist: 'Various', duration: 12 }), track('c', { artist: 'Artist 2', duration: 8 })])
    expect(groups.map(g => g.key)).toEqual(['Artist 2', 'Artist 10'])
    expect(ids(groups[0]!.tracks)).toEqual(['b', 'c'])
    expect(groups[0]!.duration).toBe(20)
  })
  it('groups genres and collects absent or blank genres under Unknown Genre', () => {
    const groups = groupGenres([track('a'), track('b', { genre: ' ' }), track('c', { genre: 'Rock' }), track('d', { genre: 'Ambient' })])
    expect(groups.map(g => g.key)).toEqual(['Ambient', 'Rock', 'Unknown Genre'])
    expect(groups[2]!.duration).toBe(120)
    expect(ids(groups[2]!.tracks)).toEqual(['a', 'b'])
  })
  it('handles empty libraries', () => {
    expect(groupAlbums([])).toEqual([])
    expect(groupArtists([])).toEqual([])
    expect(groupGenres([])).toEqual([])
  })
})

describe('play history', () => {
  const tracks = [track('unplayed'), track('old', { playCount: 3, lastPlayedAt: 0 }), track('new', { playCount: 1, lastPlayedAt: 100 }), track('unknown', { playCount: 2 })]
  it('selects exactly zero play counts in input order', () => {
    expect(ids(unplayed(tracks))).toEqual(['unplayed'])
    expect(unplayed([])).toEqual([])
  })
  it('selects timestamped tracks newest first, respecting limits', () => {
    expect(ids(recents(tracks, 1))).toEqual(['new'])
    expect(ids(recents(tracks, 10))).toEqual(['new', 'old'])
    expect(ids(recents(tracks, 1.9))).toEqual(['new'])
    for (const limit of [0, -1, NaN]) expect(recents(tracks, limit)).toEqual([])
    expect(recents([], 10)).toEqual([])
    expect(ids(tracks)).toEqual(['unplayed', 'old', 'new', 'unknown'])
  })
})

it('all helpers accept frozen inputs without mutating tracks', () => {
  const tracks = Object.freeze([Object.freeze(track('b', { trackNo: 2 })), Object.freeze(track('a', { trackNo: 1, lastPlayedAt: 1 }))])
  const before = JSON.stringify(tracks)
  searchTracks(tracks, 'a')
  sortTracks(tracks, 'title')
  groupAlbums(tracks)
  groupArtists(tracks)
  groupGenres(tracks)
  unplayed(tracks)
  recents(tracks, 2)
  expect(JSON.stringify(tracks)).toBe(before)
})
