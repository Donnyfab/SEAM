import { describe, expect, it, vi } from 'vitest'
import { JellyfinClient, JellyfinError, toTrackLike } from '../src/connect/jellyfin'

function setup(payload: unknown = { Items: [] }, status = 200) {
  const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () =>
    new Response(JSON.stringify(payload), { status }))
  const client = new JellyfinClient({
    baseUrl: 'https://music.example/jellyfin///', deviceId: 'web + &é',
    accessToken: 'token + &?', userId: 'user/&', fetchFn,
  })
  const url = (index = 0) => new URL(String(fetchFn.mock.calls[index]![0]))
  return { client, fetchFn, url }
}

describe('JellyfinClient', () => {
  it('authenticates with client identification and stores the returned session', async () => {
    const { client, fetchFn, url } = setup({ AccessToken: 'new token', User: { Id: 'new-user' } })
    expect(await client.authenticate('Beyoncé + &', 'secret')).toEqual({ accessToken: 'new token', userId: 'new-user' })
    expect(url().pathname).toBe('/jellyfin/Users/AuthenticateByName')
    const init = fetchFn.mock.calls[0]![1]!
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ Username: 'Beyoncé + &', Pw: 'secret' })
    const headers = new Headers(init.headers)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('X-Emby-Authorization')).toBe(
      'MediaBrowser Client="SEAM", Device="Web", DeviceId="web + &é", Version="0.1"',
    )
    expect(client.accessToken).toBe('new token')
    expect(client.userId).toBe('new-user')
    fetchFn.mockResolvedValueOnce(new Response('{"Items":[]}'))
    await client.getViews()
    expect(url(1).pathname).toBe('/jellyfin/Users/new-user/Views')
    expect(new Headers(fetchFn.mock.calls[1]![1]?.headers).get('X-Emby-Authorization')).toContain('Token="new token"')
    expect(new URL(client.downloadUrl('song')).searchParams.get('api_key')).toBe('new token')
  })

  it('supports first-time authentication without a stored session', async () => {
    const { fetchFn } = setup({ AccessToken: 'token', User: { Id: 'user' } })
    const client = new JellyfinClient({ baseUrl: 'https://music.example', deviceId: 'web', fetchFn })
    await expect(client.authenticate('user', '')).resolves.toEqual({ accessToken: 'token', userId: 'user' })
  })

  it('gets views and preserves server order', async () => {
    const items = [{ Id: 'b', Name: 'Music' }, { Id: 'a', Name: 'More music' }]
    const { client, url } = setup({ Items: items, TotalRecordCount: 2 })
    expect(await client.getViews()).toEqual(items)
    expect(url().pathname).toBe('/jellyfin/Users/user%2F%26/Views')
    expect(url().searchParams.has('api_key')).toBe(false)
  })

  it('lists albums with an optional parent and pagination', async () => {
    const { client, url } = setup({ Items: [{ Id: 'album' }] })
    expect(await client.getAlbums('library +/&', 25, 10)).toEqual([{ Id: 'album' }])
    expect(url().pathname).toBe('/jellyfin/Users/user%2F%26/Items')
    expect(Object.fromEntries(url().searchParams)).toMatchObject({
      IncludeItemTypes: 'MusicAlbum', ParentId: 'library +/&', Recursive: 'true', StartIndex: '25', Limit: '10',
    })
    await client.getAlbums()
    expect(url(1).searchParams.has('ParentId')).toBe(false)
    expect(url(1).searchParams.get('StartIndex')).toBe('0')
    expect(url(1).searchParams.get('Limit')).toBe('100')
    await client.getAlbums(undefined, 0, 0)
    expect(url(2).searchParams.get('Limit')).toBe('0')
  })

  it('requests album tracks in disc/track order and searches only audio', async () => {
    const { client, url } = setup({ Items: [{ Id: 'song' }] })
    expect(await client.getAlbumTracks('album +/&')).toEqual([{ Id: 'song' }])
    expect(Object.fromEntries(url().searchParams)).toMatchObject({
      IncludeItemTypes: 'Audio', ParentId: 'album +/&', SortBy: 'ParentIndexNumber,IndexNumber,SortName',
    })
    expect(await client.searchAudio('Beyoncé + A&B / ?')).toEqual([{ Id: 'song' }])
    expect(Object.fromEntries(url(1).searchParams)).toEqual({
      IncludeItemTypes: 'Audio', Recursive: 'true', SearchTerm: 'Beyoncé + A&B / ?',
    })
  })

  it('returns empty collections', async () => {
    const { client } = setup()
    expect(await client.getViews()).toEqual([])
    expect(await client.getAlbums()).toEqual([])
    expect(await client.getAlbumTracks('a')).toEqual([])
    expect(await client.searchAudio('')).toEqual([])
  })

  it('builds encoded authenticated media URLs without fetching', () => {
    const { client, fetchFn } = setup()
    const stream = new URL(client.streamUrl('song +/&?'))
    expect(stream.pathname).toBe('/jellyfin/Audio/song%20%2B%2F%26%3F/universal')
    expect(Object.fromEntries(stream.searchParams)).toEqual({
      api_key: 'token + &?', Container: 'mp3,aac,m4a,flac,wav', UserId: 'user/&', DeviceId: 'web + &é',
    })
    expect(new URL(client.streamUrl('s', true)).searchParams.get('static')).toBe('true')
    expect(new URL(client.streamUrl('s', false)).searchParams.has('static')).toBe(false)
    const download = new URL(client.downloadUrl('song/&'))
    expect(download.pathname).toBe('/jellyfin/Items/song%2F%26/Download')
    expect(download.searchParams.get('api_key')).toBe('token + &?')
    const image = new URL(client.imageUrl('song/&', 320))
    expect(image.pathname).toBe('/jellyfin/Items/song%2F%26/Images/Primary')
    expect(image.searchParams.get('maxWidth')).toBe('320')
    expect(image.searchParams.get('api_key')).toBe('token + &?')
    expect(new URL(client.imageUrl('s')).searchParams.has('maxWidth')).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it.each([401, 403, 500])('provides typed HTTP errors even for non-JSON HTTP %i responses', async status => {
    const { client, fetchFn } = setup()
    fetchFn.mockImplementation(async () => new Response('Server failure', { status }))
    await expect(client.getViews()).rejects.toBeInstanceOf(JellyfinError)
    await expect(client.getViews()).rejects.toMatchObject({ status, name: 'JellyfinError', message: `Jellyfin HTTP error ${status}` })
  })

  it('wraps network and JSON failures as typed errors', async () => {
    const { client, fetchFn } = setup()
    const cause = new TypeError('Offline')
    fetchFn.mockRejectedValueOnce(cause)
    await expect(client.getViews()).rejects.toMatchObject({ status: 0, cause })
    fetchFn.mockResolvedValueOnce(new Response('not JSON'))
    await expect(client.getViews()).rejects.toMatchObject({ status: 200, message: 'Invalid Jellyfin JSON response' })
  })

  it.each([null, {}, { Items: null }, { Items: [null] }, { Items: [{ Id: 42 }] }])('rejects malformed item responses (%j)', async body => {
    const { client } = setup(body)
    await expect(client.getViews()).rejects.toThrow(JellyfinError)
  })

  it.each([null, {}, { AccessToken: '', User: { Id: 'u' } }, { AccessToken: 't', User: {} }])(
    'preserves the previous session after malformed authentication (%j)', async body => {
      const { client } = setup(body)
      await expect(client.authenticate('u', 'p')).rejects.toThrow(JellyfinError)
      expect(client.accessToken).toBe('token + &?')
      expect(client.userId).toBe('user/&')
    },
  )

  it('requires authentication locally before browsing or building media URLs', async () => {
    const { fetchFn } = setup()
    const client = new JellyfinClient({ baseUrl: 'https://music.example', deviceId: 'web', fetchFn })
    expect(() => client.getViews()).toThrow(JellyfinError)
    expect(() => client.getAlbums()).toThrow(JellyfinError)
    expect(() => client.getAlbumTracks('a')).toThrow(JellyfinError)
    expect(() => client.searchAudio('a')).toThrow(JellyfinError)
    expect(() => client.streamUrl('a')).toThrow(JellyfinError)
    expect(() => client.downloadUrl('a')).toThrow(JellyfinError)
    expect(() => client.imageUrl('a')).toThrow(JellyfinError)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('toTrackLike', () => {
  it('converts ticks to fractional seconds and maps metadata without mutation', () => {
    const item = Object.freeze({
      Id: 's', Name: 'Title', Artists: ['A', 'B'], Album: 'Album', RunTimeTicks: 123456789,
      IndexNumber: 3, ProductionYear: 2026, Genres: ['Jazz', 'Soul'],
    })
    const expected = {
      id: 's', title: 'Title', artist: 'A, B', album: 'Album', duration: 12.3456789,
      trackNo: 3, year: 2026, genre: 'Jazz, Soul',
    }
    expect(toTrackLike(item)).toEqual(expected)
    expect(setup().client.toTrackLike(item)).toEqual(expected)
  })

  it('handles missing/null metadata, album artist fallback and zero values', () => {
    expect(toTrackLike({ Id: 's', Name: null, Artists: null, RunTimeTicks: null })).toEqual({
      id: 's', title: 'Unknown Title', artist: 'Unknown Artist', album: 'Unknown Album', duration: 0,
      trackNo: undefined, year: undefined, genre: undefined,
    })
    expect(toTrackLike({ Id: 's', Artists: [], AlbumArtist: 'A', Genres: [], IndexNumber: 0 })).toMatchObject({
      artist: 'A', genre: undefined, trackNo: 0,
    })
  })
})
