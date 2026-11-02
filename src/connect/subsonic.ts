import { md5 } from './md5'

export interface SubsonicOptions {
  baseUrl: string
  username: string
  password: string
  fetchFn?: typeof fetch
  randomSalt?: () => string
}

export interface SubsonicArtist {
  id: string
  name: string
  albumCount?: number
  coverArt?: string
}

export interface SubsonicSong {
  id: string
  title: string
  artist?: string
  album?: string
  duration?: number
  track?: number
  year?: number
  genre?: string
}

export interface SubsonicAlbum {
  id: string
  name: string
  artist?: string
  coverArt?: string
  songCount?: number
  duration?: number
  year?: number
  genre?: string
  song?: SubsonicSong[]
}

export interface SubsonicSearchResult {
  artist: SubsonicArtist[]
  album: SubsonicAlbum[]
  song: SubsonicSong[]
}

export type AlbumListType = 'newest' | 'alphabeticalByName' | 'recent' | 'random'

export class SubsonicError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message)
    this.name = 'SubsonicError'
  }
}

interface SubsonicResponse {
  status: 'ok' | 'failed'
  error?: { code: number; message: string }
  artists?: { index?: { artist?: SubsonicArtist[] }[] }
  albumList2?: { album?: SubsonicAlbum[] }
  album?: SubsonicAlbum
  searchResult3?: Partial<SubsonicSearchResult>
}

/** Metadata shape shared with library tracks; durations are in seconds. */
export function toTrackLike(song: SubsonicSong) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist ?? 'Unknown Artist',
    album: song.album ?? 'Unknown Album',
    duration: song.duration ?? 0,
    trackNo: song.track,
    year: song.year,
    genre: song.genre,
  }
}

function randomSalt(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export class SubsonicClient {
  private readonly options: SubsonicOptions
  private readonly fetchFn: typeof fetch
  private readonly salt: () => string

  constructor(options: SubsonicOptions) {
    this.options = { ...options }
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis)
    this.salt = options.randomSalt ?? randomSalt
  }

  private url(method: string, params: Record<string, string | number | undefined> = {}): string {
    const salt = this.salt()
    const base = this.options.baseUrl.replace(/\/+$/, '')
    const url = new URL(`${base}/rest/${method}.view`)
    url.search = new URLSearchParams({
      u: this.options.username, t: md5(this.options.password + salt), s: salt,
      v: '1.16.1', c: 'SEAM', f: 'json',
    }).toString()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  private async request(method: string, params?: Record<string, string | number>): Promise<SubsonicResponse> {
    const response = await this.fetchFn(this.url(method, params))
    // Check the API envelope before HTTP status: servers may include useful API errors on HTTP failures.
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null || !('subsonic-response' in body)) {
      throw new Error('Invalid Subsonic response')
    }
    const result = body['subsonic-response'] as SubsonicResponse | null
    if (result?.status === 'failed') {
      throw new SubsonicError(result.error?.code ?? 0, result.error?.message ?? 'Subsonic request failed')
    }
    if (!response.ok) throw new Error(`Subsonic HTTP error ${response.status}`)
    if (result?.status !== 'ok') throw new Error('Invalid Subsonic response status')
    return result
  }

  async ping(): Promise<void> {
    await this.request('ping')
  }

  async getArtists(): Promise<SubsonicArtist[]> {
    const result = await this.request('getArtists')
    return result.artists?.index?.flatMap(index => index.artist ?? []) ?? []
  }

  async getAlbumList(type: AlbumListType, size: number, offset: number): Promise<SubsonicAlbum[]> {
    const result = await this.request('getAlbumList2', { type, size, offset })
    return result.albumList2?.album ?? []
  }

  async getAlbum(id: string): Promise<SubsonicAlbum> {
    const result = await this.request('getAlbum', { id })
    if (!result.album) throw new Error('Subsonic response is missing album')
    return result.album
  }

  async search(query: string): Promise<SubsonicSearchResult> {
    const result = (await this.request('search3', { query })).searchResult3
    return { artist: result?.artist ?? [], album: result?.album ?? [], song: result?.song ?? [] }
  }

  streamUrl(songId: string, maxBitRate?: number): string {
    return this.url('stream', { id: songId, maxBitRate })
  }

  downloadUrl(songId: string): string {
    return this.url('download', { id: songId })
  }

  coverArtUrl(id: string, size?: number): string {
    return this.url('getCoverArt', { id, size })
  }
}
