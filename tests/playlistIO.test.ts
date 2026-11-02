import { describe, expect, it } from 'vitest'
import type { Playlist } from '../src/library/store'
import {
  exportM3U, exportSeamJson, formatTotal, matchEntries, moveItem,
  parsePlaylistFile, playlistDuration, searchPlaylists, sortPlaylists,
  type PlaylistTrack,
} from '../src/library/playlistIO'

const tracks: PlaylistTrack[] = [
  { id: 'a', title: 'Déjà Vu', artist: 'Beyoncé', album: 'First', duration: 60.5, fileName: 'one.mp3' },
  { id: 'b', title: 'Same', artist: 'Other', album: 'Second', duration: 120, fileName: 'two.flac' },
  { id: 'c', title: 'Same', artist: 'Third', album: '', duration: 45 },
]
const byId = new Map(tracks.map(t => [t.id, t]))
const playlist = (id: string, name: string, trackIds: string[], updatedAt = 0, createdAt?: number): Playlist =>
  ({ id, name, trackIds, updatedAt, ...(createdAt === undefined ? {} : { createdAt }) })
const p = playlist('p', 'Café Mix', ['a', 'missing', 'b'])

describe('playlist totals', () => {
  it('sums available durations without mutating the playlist or map', () => {
    expect(playlistDuration(p, byId)).toBe(180.5)
    expect(playlistDuration(playlist('x', '', []), byId)).toBe(0)
    expect(playlistDuration(playlist('x', '', ['a', 'a']), byId)).toBe(121)
    const invalid = new Map([['a', { duration: NaN }], ['b', { duration: -1 }], ['c', { duration: Infinity }]])
    expect(playlistDuration(playlist('x', '', ['a', 'b', 'c']), invalid)).toBe(0)
    expect(p.trackIds).toEqual(['a', 'missing', 'b'])
    expect(byId.size).toBe(3)
  })
  it.each([
    [0, '0 seconds'], [1, '1 second'], [45, '45 seconds'], [59.9, '59 seconds'],
    [60, '1 minute'], [720, '12 minutes'], [3599, '59 minutes'], [3600, '1 hour'],
    [3660, '1 hour 1 minute'], [3900, '1 hour 5 minutes'], [7320, '2 hours 2 minutes'],
    [-10, '0 seconds'], [NaN, '0 seconds'], [Infinity, '0 seconds'],
  ])('formats %s as %s', (seconds, expected) => expect(formatTotal(seconds)).toBe(expected))
})

describe('playlist sorting and searching', () => {
  const list = [
    playlist('1', 'Mix 10', ['a'], 30, 1),
    playlist('2', 'Mix 2', ['b', 'c'], 10, 3),
    playlist('3', 'mix 2', [], 20),
  ]
  it.each([
    ['name', ['2', '3', '1'], ['1', '2', '3']],
    ['created', ['1', '2', '3'], ['3', '2', '1']],
    ['updated', ['2', '3', '1'], ['1', '3', '2']],
    ['duration', ['3', '1', '2'], ['2', '1', '3']],
    ['count', ['3', '1', '2'], ['2', '1', '3']],
  ] as const)('sorts by %s in both directions', (key, asc, desc) => {
    expect(sortPlaylists(list, key, 'asc', byId).map(x => x.id)).toEqual(asc)
    expect(sortPlaylists(list, key, 'desc', byId).map(x => x.id)).toEqual(desc)
    expect(list.map(x => x.id)).toEqual(['1', '2', '3'])
  })
  it('preserves input order on numeric ties in either direction', () => {
    const tied = list.map(x => ({ ...x, trackIds: [], updatedAt: 0, createdAt: 0 }))
    for (const key of ['created', 'updated', 'duration', 'count'] as const) {
      for (const dir of ['asc', 'desc'] as const) expect(sortPlaylists(tied, key, dir, byId)).toEqual(tied)
    }
  })
  it('matches every term across the name and contained track titles/artists', () => {
    const all = [p, ...list]
    expect(searchPlaylists(all, 'CAFE BEYONCE de\u0301ja\u0300 OTHER', byId)).toEqual([p])
    expect(searchPlaylists(all, 'cafe absent', byId)).toEqual([])
    expect(searchPlaylists(all, 'First', byId)).toEqual([])
    expect(searchPlaylists(all, '  \t ', byId)).toEqual(all)
    expect(searchPlaylists(all, 'MIX 10', byId)).toEqual([list[0]])
  })
})

describe('playlist export', () => {
  it('writes ordered M3U metadata and file names, skipping missing tracks', () => {
    expect(exportM3U(p, byId)).toBe('#EXTM3U\n#PLAYLIST:Café Mix\n#EXTINF:60.5,Beyoncé - Déjà Vu\none.mp3\n#EXTINF:120,Other - Same\ntwo.flac\n')
    expect(exportM3U(playlist('x', 'Empty', []), byId)).toBe('#EXTM3U\n#PLAYLIST:Empty\n')
    expect(exportM3U(playlist('x', 'Fallback', ['c']), byId)).toContain('\nSame\n')
  })
  it('keeps M3U fields on a single LF-delimited line', () => {
    const unusual = { ...tracks[0]!, title: 'Title\r\nInjected', artist: 'A\rB', fileName: 'a\nb.mp3' }
    const result = exportM3U(playlist('x', 'Name\r\nNext', ['a']), new Map([['a', unusual]]))
    expect(result).toBe('#EXTM3U\n#PLAYLIST:Name Next\n#EXTINF:60.5,A B - Title Injected\na b.mp3\n')
  })
  it('exports the versioned JSON schema without internal fields', () => {
    const result: unknown = JSON.parse(exportSeamJson(playlist('x', 'Test', ['c', 'missing', 'a']), byId))
    expect(result).toEqual({ format: 'seam-playlist', version: 1, name: 'Test', tracks: [
      { title: 'Same', artist: 'Third', album: '', duration: 45, fileName: '' },
      { title: 'Déjà Vu', artist: 'Beyoncé', album: 'First', duration: 60.5, fileName: 'one.mp3' },
    ] })
  })
  it('round trips both exported formats through parsing and matching', () => {
    for (const [name, text] of [['test.m3u', exportM3U(p, byId)], ['test.json', exportSeamJson(p, byId)]]) {
      const parsed = parsePlaylistFile(name!, text!)
      expect(parsed.name).toBe(p.name)
      expect(matchEntries(parsed.entries, tracks)).toEqual({ ids: ['a', 'b'], unmatched: [] })
    }
  })
})

describe('playlist file parsing', () => {
  it('reads M3U8 BOM, CRLF, comments, Windows/POSIX paths and comma-containing titles', () => {
    expect(parsePlaylistFile('fallback.M3U8', '\uFEFF#EXTM3U\r\n#PLAYLIST:Imported\r\n#EXTINF:12.5,Artist - Title, Live\r\n# comment\r\nC:\\Music\\one.mp3\r\n../two.flac\r\n')).toEqual({
      name: 'Imported', entries: [{ artist: 'Artist', title: 'Title, Live', duration: 12.5, fileName: 'one.mp3' }, { fileName: 'two.flac' }],
    })
  })
  it('ignores URLs and orphan metadata and clears metadata after a skipped URL', () => {
    expect(parsePlaylistFile('/music/My.Mix.m3u', '#EXTINF:5,Remote\nhttps://host/song\nlocal.mp3\n//host/song\nftp://host/song\ndata:audio/test\n#EXTINF:5,Orphan')).toEqual({ name: 'My.Mix', entries: [{ fileName: 'local.mp3' }] })
  })
  it('ignores invalid durations and handles empty/malformed metadata', () => {
    expect(parsePlaylistFile('x.m3u', '#EXTINF:-1,Title\na\n#EXTINF:nope,A - B\nb\n#EXTINF:0,\nc\n#EXTINF:broken\nd')).toEqual({ name: 'x', entries: [
      { title: 'Title', fileName: 'a' }, { artist: 'A', title: 'B', fileName: 'b' }, { duration: 0, fileName: 'c' }, { fileName: 'd' },
    ] })
    expect(parsePlaylistFile('Empty.m3u', '')).toEqual({ name: 'Empty', entries: [] })
  })
  it('reads PLS fields case-insensitively in numeric order and skips URLs/orphans', () => {
    const input = '[playlist]\r\nFile10=../ten.mp3\r\nTitle10=A - Last\r\nLength10=0\r\nTitle2=Solo\r\nLength2=12.5\r\nfile2=C:\\music\\two.flac\r\nFile1=https://host/a=b\r\nTitle3=orphan\r\nFile0=invalid\r\nFile4=\r\nNumberOfEntries=10'
    expect(parsePlaylistFile('C:\\lists\\A.PLS', input)).toEqual({ name: 'A', entries: [
      { title: 'Solo', duration: 12.5, fileName: 'two.flac' }, { artist: 'A', title: 'Last', duration: 0, fileName: 'ten.mp3' },
    ] })
    expect(parsePlaylistFile('a.pls', 'File1=a\nLength1=bad\nFile2=b\nLength2=-1\nFile3=c\nLength3=')).toEqual({ name: 'a', entries: [{ fileName: 'a' }, { fileName: 'b' }, { fileName: 'c' }] })
  })
  it('validates SEAM JSON and only accepts correctly typed entry fields', () => {
    const text = JSON.stringify({ format: 'seam-playlist', version: 1, name: 'Saved', tracks: [
      null, 5, {}, { artist: 'orphan' }, { title: 'Valid', artist: 1, duration: -1, fileName: false },
      { fileName: 'file.mp3', duration: 0 }, { title: 'No duration', duration: '12' },
    ] })
    expect(parsePlaylistFile('fallback.json', '\uFEFF' + text)).toEqual({ name: 'Saved', entries: [{ title: 'Valid' }, { fileName: 'file.mp3', duration: 0 }, { title: 'No duration' }] })
    expect(parsePlaylistFile('fallback.json', '{"format":"seam-playlist","version":1,"tracks":[]}').name).toBe('fallback')
    for (const invalid of ['{', 'null', '[]', '{}', '{"format":"seam-playlist","version":2,"tracks":[]}']) expect(() => parsePlaylistFile('x.json', invalid)).toThrow()
    expect(() => parsePlaylistFile('x.txt', '')).toThrow('Unsupported')
  })
})

describe('entry matching', () => {
  it('prioritizes file name, then artist/title, then globally unique titles', () => {
    expect(matchEntries([
      { fileName: 'TWO.FLAC', artist: 'Beyoncé', title: 'Déjà Vu' },
      { fileName: 'missing', artist: 'THIRD', title: 'SAME' },
      { title: 'DÉJÀ VU' }, { title: 'Same' }, { fileName: 'lost.mp3' },
      { artist: 'Missing', title: 'Song' },
    ], tracks)).toEqual({ ids: ['b', 'c', 'a'], unmatched: ['Same', 'lost.mp3', 'Missing - Song'] })
  })
  it('skips duplicate matches without selecting another ambiguous track', () => {
    expect(matchEntries([{ fileName: 'one.mp3' }, { title: 'Déjà Vu' }, { title: 'Same' }, { artist: 'Other', title: 'Same' }], tracks)).toEqual({ ids: ['a', 'b'], unmatched: ['Same'] })
    expect(matchEntries([], tracks)).toEqual({ ids: [], unmatched: [] })
    expect(matchEntries([{ title: 'Absent' }], [])).toEqual({ ids: [], unmatched: ['Absent'] })
  })
})

describe('immutable item reordering', () => {
  it.each([
    [0, 2, ['b', 'c', 'a']], [2, 0, ['c', 'a', 'b']], [1, 1, ['a', 'b', 'c']],
    [-100, 100, ['b', 'c', 'a']], [100, -1, ['c', 'a', 'b']],
    [0.9, 1.9, ['b', 'a', 'c']], [NaN, Infinity, ['b', 'c', 'a']],
  ])('moves %s to %s with clamping', (from, to, expected) => {
    const input = Object.freeze(['a', 'b', 'c'])
    const result = moveItem(input, from, to)
    expect(result).toEqual(expected)
    expect(input).toEqual(['a', 'b', 'c'])
    expect(result).not.toBe(input)
  })
  it('supports empty/single arrays, undefined items and object identity', () => {
    expect(moveItem([], 0, 10)).toEqual([])
    expect(moveItem([1], -1, 50)).toEqual([1])
    expect(moveItem([undefined, 1], 0, 1)).toEqual([1, undefined])
    const item = { id: 1 }
    expect(moveItem([item, { id: 2 }], 0, 1)[1]).toBe(item)
  })
})
