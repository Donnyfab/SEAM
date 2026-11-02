import { md5 } from './md5'

export interface LastFmOptions {
  apiKey: string
  apiSecret: string
  sessionKey?: string
  fetchFn?: typeof fetch
}

export interface NowPlayingTrack {
  artist: string
  track: string
  album?: string
  /** Seconds. */
  duration?: number
}

export interface ScrobbleEntry extends NowPlayingTrack {
  /** Playback start time, in integer Unix seconds. */
  timestamp: number
}

export class LastFmError extends Error {
  /** Code 0 denotes a local protocol/HTTP error; other codes come from Last.fm. */
  constructor(public readonly code: number, message: string) {
    super(message)
    this.name = 'LastFmError'
  }
}

/** Sign raw (not URL-encoded) values, in ASCII parameter-name order. */
export function apiSignature(params: Readonly<Record<string, string | number>>, secret: string): string {
  const names = Object.keys(params).filter(name => !['format', 'callback', 'api_sig'].includes(name)).sort()
  return md5(names.map(name => name + String(params[name])).join('') + secret)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class LastFmClient {
  private readonly options: LastFmOptions
  private readonly fetchFn: typeof fetch
  private sessionKey: string | undefined

  constructor(options: LastFmOptions) {
    this.options = { ...options }
    this.sessionKey = options.sessionKey
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis)
  }

  private async request(method: string, params: Record<string, string>, envelope: string): Promise<Record<string, unknown>> {
    const fields = { ...params, method, api_key: this.options.apiKey }
    const body = new URLSearchParams({ ...fields, api_sig: apiSignature(fields, this.options.apiSecret), format: 'json' })
    const response = await this.fetchFn('https://ws.audioscrobbler.com/2.0/', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
    })
    let result: unknown
    try {
      result = await response.json()
    } catch {
      throw new LastFmError(0, `Invalid Last.fm JSON response (HTTP ${response.status})`)
    }
    if (isRecord(result) && typeof result.error === 'number') {
      throw new LastFmError(result.error, typeof result.message === 'string' ? result.message : 'Last.fm request failed')
    }
    if (!response.ok) throw new LastFmError(0, `Last.fm HTTP error ${response.status}`)
    if (!isRecord(result) || !isRecord(result[envelope])) throw new LastFmError(0, 'Invalid Last.fm response')
    return result[envelope]
  }

  private session(): string {
    if (!this.sessionKey) throw new LastFmError(9, 'Last.fm session key required')
    return this.sessionKey
  }

  /** Retains the returned key for subsequent calls; credentials are not retained. */
  async getMobileSession(username: string, password: string): Promise<string> {
    const session = await this.request('auth.getMobileSession', { username, password }, 'session')
    if (typeof session.key !== 'string' || !session.key) throw new LastFmError(0, 'Last.fm response is missing session key')
    this.sessionKey = session.key
    return session.key
  }

  async updateNowPlaying(track: NowPlayingTrack): Promise<void> {
    const params: Record<string, string> = { artist: track.artist, track: track.track, sk: this.session() }
    if (track.album !== undefined) params.album = track.album
    if (track.duration !== undefined) params.duration = String(track.duration)
    await this.request('track.updateNowPlaying', params, 'nowplaying')
  }

  /** Sequential batches; stops on failure. For offline retries, submit one queue batch at a time. */
  async scrobble(entries: readonly ScrobbleEntry[]): Promise<void> {
    if (entries.length === 0) return
    const sk = this.session()
    for (let offset = 0; offset < entries.length; offset += 50) {
      const params: Record<string, string> = { sk }
      entries.slice(offset, offset + 50).forEach((entry, index) => {
        params[`artist[${index}]`] = entry.artist
        params[`track[${index}]`] = entry.track
        params[`timestamp[${index}]`] = String(entry.timestamp)
        if (entry.album !== undefined) params[`album[${index}]`] = entry.album
        if (entry.duration !== undefined) params[`duration[${index}]`] = String(entry.duration)
      })
      await this.request('track.scrobble', params, 'scrobbles')
    }
  }
}

export function shouldScrobble(playedSeconds: number, durationSeconds: number): boolean {
  return Number.isFinite(playedSeconds) && Number.isFinite(durationSeconds)
    && durationSeconds > 30 && playedSeconds >= Math.min(durationSeconds / 2, 240)
}

function entryKey(entry: ScrobbleEntry): string {
  return JSON.stringify([entry.artist, entry.track, entry.timestamp])
}

/** In-memory FIFO with no I/O or clock. Persist JSON.stringify(queue) between retries. */
export class ScrobbleQueue {
  private entries = new Map<string, ScrobbleEntry>()

  get size(): number { return this.entries.size }

  enqueue(entry: ScrobbleEntry): void {
    const key = entryKey(entry)
    if (!this.entries.has(key)) this.entries.set(key, { ...entry })
  }

  /** Non-destructive: failed attempts remain available until explicitly acknowledged. */
  takeBatch(n: number): ScrobbleEntry[] {
    if (!Number.isInteger(n) || n < 0) throw new RangeError('Batch size must be a non-negative integer')
    return Array.from(this.entries.values()).slice(0, n).map(entry => ({ ...entry }))
  }

  markDone(entries: readonly ScrobbleEntry[]): void {
    for (const entry of entries) this.entries.delete(entryKey(entry))
  }

  toJSON(): ScrobbleEntry[] {
    return this.takeBatch(this.size)
  }

  /** Accepts the parsed value of JSON.stringify(queue). Rejects corrupt persisted data. */
  static fromJSON(value: unknown): ScrobbleQueue {
    if (!Array.isArray(value)) throw new TypeError('Invalid scrobble queue')
    const queue = new ScrobbleQueue()
    for (const entry of value) {
      if (!isRecord(entry) || typeof entry.artist !== 'string' || typeof entry.track !== 'string'
        || typeof entry.timestamp !== 'number' || !Number.isSafeInteger(entry.timestamp) || entry.timestamp < 0
        || (entry.album !== undefined && typeof entry.album !== 'string')
        || (entry.duration !== undefined && (typeof entry.duration !== 'number' || !Number.isFinite(entry.duration) || entry.duration < 0))) {
        throw new TypeError('Invalid scrobble queue entry')
      }
      queue.enqueue({ artist: entry.artist, track: entry.track, timestamp: entry.timestamp,
        ...(entry.album !== undefined ? { album: entry.album } : {}),
        ...(entry.duration !== undefined ? { duration: entry.duration as number } : {}),
      })
    }
    return queue
  }
}
