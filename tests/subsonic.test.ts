import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { md5 } from '../src/connect/md5'
import { SubsonicClient, SubsonicError, toTrackLike } from '../src/connect/subsonic'
import type { AlbumListType } from '../src/connect/subsonic'

function setup(payload: Record<string, unknown> = {}, status = 200) {
  const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({
    'subsonic-response': { status: 'ok', ...payload },
  }), { status }))
  const client = new SubsonicClient({
    baseUrl: 'https://music.example/navidrome///', username: 'user + &é', password: 'sesame',
    fetchFn, randomSalt: () => 'c19b2d',
  })
  const requestUrl = () => new URL(String(fetchFn.mock.calls[0]![0]))
  return { client, fetchFn, requestUrl }
}

describe('md5', () => {
  it('matches the required known vector', () => {
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
  })
  it.each(['', 'a', 'message digest', 'é🎵密碼', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'abc'.repeat(1000)])(
    'matches reference hashes for UTF-8 and block/padding boundaries (%#. case)', text => {
      expect(md5(text)).toBe(createHash('md5').update(text, 'utf8').digest('hex'))
    },
  )
})

describe('SubsonicClient', () => {
  it('pings using token auth, encoding credentials and preserving the base path', async () => {
    const { client, fetchFn, requestUrl } = setup()
    await expect(client.ping()).resolves.toBeUndefined()
    expect(fetchFn).toHaveBeenCalledOnce()
    expect(requestUrl().pathname).toBe('/navidrome/rest/ping.view')
    expect(Object.fromEntries(requestUrl().searchParams)).toEqual({
      u: 'user + &é', t: '26719a1196d2a940705a59634eb18eab', s: 'c19b2d',
      v: '1.16.1', c: 'SEAM', f: 'json',
    })
    expect(requestUrl().searchParams.has('p')).toBe(false)
  })

  it('flattens indexed artists in server order, including empty indexes', async () => {
    const artists = [{ id: '1', name: 'A' }, { id: '2', name: 'B' }]
    const { client, requestUrl } = setup({ artists: { index: [{ artist: [artists[0]] }, {}, { artist: [artists[1]] }] } })
    expect(await client.getArtists()).toEqual(artists)
    expect(requestUrl().pathname).toMatch(/getArtists.view$/)
  })

  it.each<AlbumListType>(['newest', 'alphabeticalByName', 'recent', 'random'])('lists %s albums with pagination', async type => {
    const albums = [{ id: 'a', name: 'Album' }]
    const { client, fetchFn, requestUrl } = setup({ albumList2: { album: albums } })
    expect(await client.getAlbumList(type, 25, 0)).toEqual(albums)
    expect(requestUrl().pathname).toMatch(/getAlbumList2.view$/)
    expect(requestUrl().searchParams.get('type')).toBe(type)
    expect(requestUrl().searchParams.get('size')).toBe('25')
    expect(requestUrl().searchParams.get('offset')).toBe('0')
    await client.getAlbumList(type, 10, 50)
    const next = new URL(String(fetchFn.mock.calls[1]![0]))
    expect(next.searchParams.get('offset')).toBe('50')
    expect(next.searchParams.get('size')).toBe('10')
  })

  it('retrieves an album with songs and URL-encodes its ID', async () => {
    const album = { id: 'a/&?', name: 'Album', song: [{ id: 's', title: 'Song' }] }
    const { client, requestUrl } = setup({ album })
    expect(await client.getAlbum(album.id)).toEqual(album)
    expect(requestUrl().pathname).toMatch(/getAlbum.view$/)
    expect(requestUrl().searchParams.get('id')).toBe(album.id)
  })

  it('searches ID3 metadata and preserves special characters in the query', async () => {
    const song = [{ id: 's', title: 'Song' }]
    const { client, requestUrl } = setup({ searchResult3: { song } })
    expect(await client.search('Beyoncé + A&B / ?')).toEqual({ artist: [], album: [], song })
    expect(requestUrl().pathname).toMatch(/search3.view$/)
    expect(requestUrl().searchParams.get('query')).toBe('Beyoncé + A&B / ?')
  })

  it('returns empty collections when optional collection fields are omitted', async () => {
    const { client } = setup()
    expect(await client.getArtists()).toEqual([])
    expect(await client.getAlbumList('newest', 20, 0)).toEqual([])
    expect(await client.search('')).toEqual({ artist: [], album: [], song: [] })
    await expect(client.getAlbum('missing')).rejects.toThrow('missing album')
  })

  it('builds authenticated media URLs without fetching and includes only provided options', () => {
    const { client, fetchFn } = setup()
    for (const [url, endpoint, option, value] of [
      [client.streamUrl('s +/&', 192), 'stream', 'maxBitRate', '192'],
      [client.streamUrl('s +/&', 0), 'stream', 'maxBitRate', '0'],
      [client.coverArtUrl('s +/&', 300), 'getCoverArt', 'size', '300'],
    ]) {
      const parsed = new URL(url!)
      expect(parsed.pathname).toBe(`/navidrome/rest/${endpoint}.view`)
      expect(parsed.searchParams.get(option!)).toBe(value)
      expect(parsed.searchParams.get('id')).toBe('s +/&')
      expect(parsed.searchParams.get('t')).toBe('26719a1196d2a940705a59634eb18eab')
    }
    expect(new URL(client.downloadUrl('s')).pathname).toMatch(/download.view$/)
    expect(new URL(client.streamUrl('s')).searchParams.has('maxBitRate')).toBe(false)
    expect(new URL(client.coverArtUrl('s')).searchParams.has('size')).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('generates a fresh salt for every request and media URL', async () => {
    const { fetchFn } = setup()
    const randomSalt = vi.fn().mockReturnValueOnce('salt01').mockReturnValueOnce('salt02')
    const client = new SubsonicClient({ baseUrl: 'https://music.example', username: 'u', password: 'p', fetchFn, randomSalt })
    await client.ping()
    const first = new URL(String(fetchFn.mock.calls[0]![0]))
    const second = new URL(client.downloadUrl('s'))
    expect(first.searchParams.get('s')).toBe('salt01')
    expect(second.searchParams.get('s')).toBe('salt02')
    expect(second.searchParams.get('t')).toBe(md5('psalt02'))
    expect(first.searchParams.get('t')).not.toBe(second.searchParams.get('t'))
  })

  it('uses a cryptographically generated salt when none is injected', async () => {
    const { fetchFn } = setup()
    const client = new SubsonicClient({ baseUrl: 'https://music.example', username: 'u', password: 'p', fetchFn })
    await client.ping()
    const url = new URL(String(fetchFn.mock.calls[0]![0]))
    expect(url.searchParams.get('s')).toMatch(/^[0-9a-f]{32}$/)
    expect(url.searchParams.get('t')).toBe(md5('p' + url.searchParams.get('s')))
  })

  it.each([200, 401])('preserves typed server errors on HTTP %i', async status => {
    const { client } = setup({ status: 'failed', error: { code: 40, message: 'Wrong username or password' } }, status)
    await expect(client.ping()).rejects.toBeInstanceOf(SubsonicError)
    await expect(client.ping()).rejects.toMatchObject({ code: 40, message: 'Wrong username or password', name: 'SubsonicError' })
  })

  it('rejects HTTP failures, malformed responses, and network errors', async () => {
    const { client, fetchFn } = setup({}, 503)
    await expect(client.ping()).rejects.toThrow('HTTP error 503')
    for (const body of [null, {}, { 'subsonic-response': null }, { 'subsonic-response': { status: 'other' } }]) {
      fetchFn.mockResolvedValueOnce(new Response(JSON.stringify(body)))
      await expect(client.ping()).rejects.toThrow('Invalid Subsonic response')
    }
    fetchFn.mockRejectedValueOnce(new TypeError('Network failed'))
    await expect(client.ping()).rejects.toThrow('Network failed')
  })
})

describe('toTrackLike', () => {
  it('maps track numbering and metadata without modifying the song', () => {
    const song = Object.freeze({ id: 's', title: 'Title', artist: 'Artist', album: 'Album', duration: 120, track: 3, year: 2026, genre: 'Jazz' })
    expect(toTrackLike(song)).toEqual({ id: 's', title: 'Title', artist: 'Artist', album: 'Album', duration: 120, trackNo: 3, year: 2026, genre: 'Jazz' })
  })
  it('supplies required library defaults and preserves absent optional metadata', () => {
    expect(toTrackLike({ id: 's', title: 'Title' })).toEqual({
      id: 's', title: 'Title', artist: 'Unknown Artist', album: 'Unknown Album', duration: 0,
      trackNo: undefined, year: undefined, genre: undefined,
    })
  })
})
