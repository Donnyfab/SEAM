import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { apiSignature, LastFmClient, LastFmError, ScrobbleQueue, shouldScrobble } from '../src/connect/lastfm'
import type { ScrobbleEntry } from '../src/connect/lastfm'

function setup(sessionKey: string | null = 'session') {
  const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () =>
    new Response(JSON.stringify({ session: { key: 'new-session' }, nowplaying: {}, scrobbles: {} })))
  const client = new LastFmClient({ apiKey: 'key', apiSecret: 'secret', sessionKey: sessionKey ?? undefined, fetchFn })
  const params = (index = 0) => new URLSearchParams(String(fetchFn.mock.calls[index]![1]!.body))
  return { client, fetchFn, params }
}

const entry = (timestamp: number): ScrobbleEntry => ({ artist: 'Beyoncé & A+B', track: 'Song / ?', timestamp })

describe('Last.fm signing', () => {
  it('matches a manually ordered signature vector from the documented algorithm', () => {
    // https://www.last.fm/api/authspec section 8: sort names, concatenate
    // name+raw value without separators, append secret, then MD5 UTF-8 bytes.
    // Sorted by hand: api_key, method, password, username. format/callback excluded.
    const input = 'api_key' + 'key' + 'method' + 'auth.getMobileSession'
      + 'password' + 'p' + 'username' + 'u' + 'secret'
    const expected = createHash('md5').update(input, 'utf8').digest('hex')
    expect(expected).toBe('50a5d52162c4f263fa0110089f6c2b9a')
    expect(apiSignature({ username: 'u', password: 'p', method: 'auth.getMobileSession',
      api_key: 'key', format: 'json', callback: 'ignored', api_sig: 'old' }, 'secret')).toBe(expected)
  })

  it('sorts indexed names lexically and hashes raw Unicode values', () => {
    const input = 'artist[0]é &+artist[10]tenartist[1]one' + 'secret'
    expect(apiSignature({ 'artist[1]': 'one', 'artist[0]': 'é &+', 'artist[10]': 'ten' }, 'secret'))
      .toBe(createHash('md5').update(input).digest('hex'))
  })
})

describe('LastFmClient', () => {
  it('authenticates over HTTPS POST and retains the session for subsequent writes', async () => {
    const { client, fetchFn, params } = setup(null)
    await expect(client.getMobileSession('u', 'p')).resolves.toBe('new-session')
    expect(fetchFn.mock.calls[0]![0]).toBe('https://ws.audioscrobbler.com/2.0/')
    expect(fetchFn.mock.calls[0]![1]).toMatchObject({ method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    expect(Object.fromEntries(params())).toEqual({ username: 'u', password: 'p', method: 'auth.getMobileSession',
      api_key: 'key', api_sig: '50a5d52162c4f263fa0110089f6c2b9a', format: 'json' })
    await client.updateNowPlaying({ artist: 'A', track: 'T' })
    expect(params(1).get('sk')).toBe('new-session')
    expect(params(1).has('password')).toBe(false)
    expect(params(1).has('username')).toBe(false)
  })

  it('encodes Now Playing metadata and omits missing optional fields', async () => {
    const { client, params } = setup()
    await client.updateNowPlaying({ artist: 'é &+', track: '?/#', album: 'Album', duration: 123 })
    expect(Object.fromEntries(params())).toMatchObject({ artist: 'é &+', track: '?/#', album: 'Album',
      duration: '123', method: 'track.updateNowPlaying', sk: 'session', format: 'json' })
    const signatureInput = 'albumAlbumapi_keykeyartisté &+duration123methodtrack.updateNowPlayingsksessiontrack?/#secret'
    expect(params().get('api_sig')).toBe(createHash('md5').update(signatureInput).digest('hex'))
    await client.updateNowPlaying({ artist: 'A', track: 'T' })
    expect(params(1).has('album')).toBe(false)
    expect(params(1).has('duration')).toBe(false)
  })

  it('splits 101 entries into 50/50/1 indexed batches without mutating the input', async () => {
    const { client, fetchFn, params } = setup()
    const entries = Object.freeze(Array.from({ length: 101 }, (_, i) => Object.freeze({ ...entry(i),
      ...(i === 0 ? { album: 'EP', duration: 180 } : {}) })))
    await client.scrobble(entries)
    expect(fetchFn).toHaveBeenCalledTimes(3)
    for (const [batch, count, start] of [[0, 50, 0], [1, 50, 50], [2, 1, 100]]) {
      const fields = params(batch)
      expect(fields.get('method')).toBe('track.scrobble')
      expect(fields.get('artist[0]')).toBe(entries[start!]!.artist)
      expect(fields.get('track[0]')).toBe(entries[start!]!.track)
      expect(fields.get('timestamp[0]')).toBe(String(start))
      expect(fields.get(`timestamp[${count! - 1}]`)).toBe(String(start! + count! - 1))
      expect(fields.has(`artist[${count}]`)).toBe(false)
      // Independent reference hash verifies each complete batch, including indices >= 10.
      const names = [...fields.keys()].filter(name => name !== 'format' && name !== 'api_sig').sort()
      expect(fields.get('api_sig')).toBe(createHash('md5')
        .update(names.map(name => name + fields.get(name)).join('') + 'secret').digest('hex'))
    }
    expect(params().get('album[0]')).toBe('EP')
    expect(params().get('duration[0]')).toBe('180')
    expect(params().has('album[1]')).toBe(false)
    expect(params().has('duration[1]')).toBe(false)
    expect(entries[100]!.timestamp).toBe(100)
  })

  it('does nothing for an empty batch and rejects writes without a session', async () => {
    const { client, fetchFn } = setup(null)
    await client.scrobble([])
    await expect(client.scrobble([entry(1)])).rejects.toMatchObject({ code: 9, name: 'LastFmError' })
    await expect(client.updateNowPlaying(entry(1))).rejects.toBeInstanceOf(LastFmError)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it.each([200, 403])('preserves typed API errors on HTTP %i', async status => {
    const { client, fetchFn } = setup()
    fetchFn.mockResolvedValue(new Response(JSON.stringify({ error: 9, message: 'Invalid session key' }), { status }))
    await expect(client.scrobble([entry(1)])).rejects.toMatchObject({ name: 'LastFmError', code: 9, message: 'Invalid session key' })
  })

  it('stops sending batches when a request fails', async () => {
    const { client, fetchFn } = setup()
    fetchFn.mockResolvedValueOnce(new Response(JSON.stringify({ error: 16, message: 'Unavailable' })))
    await expect(client.scrobble(Array.from({ length: 101 }, (_, i) => entry(i)))).rejects.toBeInstanceOf(LastFmError)
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('rejects HTTP failures, malformed responses, missing session keys and network failures', async () => {
    const { client, fetchFn } = setup()
    fetchFn.mockResolvedValueOnce(new Response('{}', { status: 503 }))
    await expect(client.getMobileSession('u', 'p')).rejects.toThrow('HTTP error 503')
    for (const value of [null, [], {}, { session: null }, { session: {} }, { session: { key: '' } }]) {
      fetchFn.mockResolvedValueOnce(new Response(JSON.stringify(value)))
      await expect(client.getMobileSession('u', 'p')).rejects.toBeInstanceOf(LastFmError)
    }
    fetchFn.mockResolvedValueOnce(new Response('not JSON'))
    await expect(client.updateNowPlaying(entry(1))).rejects.toThrow('Invalid Last.fm JSON')
    fetchFn.mockRejectedValueOnce(new TypeError('Offline'))
    await expect(client.scrobble([entry(1)])).rejects.toThrow('Offline')
  })
})

describe('shouldScrobble', () => {
  it.each([
    [30, 30, false], [100, 0, false], [100, -1, false], [15, 31, false], [15.5, 31, true],
    [89, 180, false], [90, 180, true], [239, 1000, false], [240, 1000, true],
    [-1, 180, false], [NaN, 180, false], [Infinity, 180, false], [240, Infinity, false], [240, NaN, false],
  ])('played %s / duration %s => %s', (played, duration, expected) => {
    expect(shouldScrobble(played, duration)).toBe(expected)
  })
})

describe('ScrobbleQueue', () => {
  it('deduplicates exact artist/track/timestamp tuples while preserving FIFO order', () => {
    const queue = new ScrobbleQueue()
    queue.enqueue(entry(1))
    queue.enqueue({ ...entry(1), album: 'changed' })
    queue.enqueue(entry(2))
    queue.enqueue({ ...entry(1), artist: 'Other' })
    queue.enqueue({ ...entry(1), track: 'Other' })
    expect(queue.size).toBe(4)
    const batch = queue.takeBatch(2)
    expect(batch).toEqual([entry(1), entry(2)])
    expect(queue.takeBatch(2)).toEqual(batch)
    queue.markDone([batch[0]!])
    queue.markDone([batch[0]!, entry(999)])
    expect(queue.size).toBe(3)
    expect(queue.takeBatch(1)).toEqual([entry(2)])
  })

  it('avoids delimiter collisions and keeps internal data isolated from callers', () => {
    const queue = new ScrobbleQueue()
    const original = { artist: 'a|b', track: 'c', timestamp: 1 }
    queue.enqueue(original)
    queue.enqueue({ artist: 'a', track: 'b|c', timestamp: 1 })
    original.artist = 'changed'
    queue.takeBatch(1)[0]!.track = 'changed'
    queue.toJSON()[0]!.timestamp = 9
    expect(queue.toJSON()[0]).toEqual({ artist: 'a|b', track: 'c', timestamp: 1 })
    expect(queue.size).toBe(2)
  })

  it('round-trips JSON and removes acknowledged retries after restoration', async () => {
    const queue = new ScrobbleQueue()
    queue.enqueue({ ...entry(1), album: 'EP', duration: 180 })
    queue.enqueue(entry(2))
    const restored = ScrobbleQueue.fromJSON(JSON.parse(JSON.stringify(queue)))
    expect(restored.toJSON()).toEqual(queue.toJSON())
    const { client, fetchFn } = setup()
    const batch = restored.takeBatch(50)
    fetchFn.mockRejectedValueOnce(new TypeError('Offline'))
    await expect(client.scrobble(batch)).rejects.toThrow('Offline')
    expect(restored.takeBatch(50)).toEqual(batch)
    await client.scrobble(restored.takeBatch(50))
    restored.markDone(batch)
    expect(restored.toJSON()).toEqual([])
    expect(queue.size).toBe(2)
  })

  it('handles empty and oversized batches, and rejects invalid sizes', () => {
    const queue = new ScrobbleQueue()
    expect(queue.takeBatch(10)).toEqual([])
    queue.enqueue(entry(1))
    expect(queue.takeBatch(0)).toEqual([])
    expect(queue.takeBatch(100)).toEqual([entry(1)])
    for (const n of [-1, 1.5, NaN, Infinity]) expect(() => queue.takeBatch(n)).toThrow(RangeError)
    queue.markDone(queue.takeBatch(1))
    expect(queue.size).toBe(0)
  })

  it('deduplicates restored entries and rejects corrupt persisted data', () => {
    expect(ScrobbleQueue.fromJSON([entry(1), entry(1)]).size).toBe(1)
    for (const value of [null, {}, '[]', [null], [{}], [{ ...entry(1), timestamp: 1.2 }],
      [{ ...entry(1), timestamp: -1 }], [{ ...entry(1), album: 3 }], [{ ...entry(1), duration: Infinity }]]) {
      expect(() => ScrobbleQueue.fromJSON(value)).toThrow(TypeError)
    }
  })
})
