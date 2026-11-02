export interface JellyfinOptions {
  baseUrl: string
  fetchFn?: typeof fetch
  deviceId: string
  accessToken?: string
  userId?: string
}

export interface JellyfinItem {
  Id: string
  Name?: string | null
  Artists?: string[] | null
  AlbumArtist?: string | null
  Album?: string | null
  RunTimeTicks?: number | null
  IndexNumber?: number | null
  ParentIndexNumber?: number | null
  ProductionYear?: number | null
  Genres?: string[] | null
}

export interface JellyfinSession {
  accessToken: string
  userId: string
}

/** Status 0 denotes a transport error or missing local authentication. */
export class JellyfinError extends Error {
  constructor(public readonly status: number, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'JellyfinError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Library metadata uses seconds, while Jellyfin uses 100 ns ticks. */
export function toTrackLike(item: JellyfinItem) {
  return {
    id: item.Id,
    title: item.Name ?? 'Unknown Title',
    artist: item.Artists?.join(', ') || item.AlbumArtist || 'Unknown Artist',
    album: item.Album ?? 'Unknown Album',
    duration: (item.RunTimeTicks ?? 0) / 1e7,
    trackNo: item.IndexNumber ?? undefined,
    year: item.ProductionYear ?? undefined,
    genre: item.Genres?.join(', ') || undefined,
  }
}

export class JellyfinClient {
  private readonly baseUrl: string
  private readonly fetchFn: typeof fetch
  private readonly deviceId: string
  private session: Partial<JellyfinSession>

  constructor(options: JellyfinOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis)
    this.deviceId = options.deviceId
    this.session = { accessToken: options.accessToken, userId: options.userId }
  }

  get accessToken(): string | undefined { return this.session.accessToken }
  get userId(): string | undefined { return this.session.userId }

  private url(path: string, params: Record<string, string | number | boolean | undefined> = {}): string {
    const url = new URL(`${this.baseUrl}${path}`)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  private authorization(authenticate = false): string {
    const fields: Record<string, string> = {
      Client: 'SEAM', Device: 'Web', DeviceId: this.deviceId, Version: '0.1',
    }
    if (!authenticate && this.accessToken) fields.Token = this.accessToken
    return 'MediaBrowser ' + Object.entries(fields)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', ')
  }

  private async request(path: string, params?: Record<string, string | number | boolean | undefined>, body?: object): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchFn(this.url(path, params), {
        method: body ? 'POST' : 'GET',
        headers: {
          'X-Emby-Authorization': this.authorization(body !== undefined),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch (cause) {
      throw new JellyfinError(0, 'Jellyfin network request failed', { cause })
    }
    if (!response.ok) throw new JellyfinError(response.status, `Jellyfin HTTP error ${response.status}`)
    try {
      return await response.json() as unknown
    } catch (cause) {
      throw new JellyfinError(response.status, 'Invalid Jellyfin JSON response', { cause })
    }
  }

  async authenticate(username: string, password: string): Promise<JellyfinSession> {
    const body = await this.request('/Users/AuthenticateByName', undefined, { Username: username, Pw: password })
    if (!isRecord(body) || typeof body.AccessToken !== 'string' || !body.AccessToken ||
        !isRecord(body.User) || typeof body.User.Id !== 'string' || !body.User.Id) {
      throw new JellyfinError(200, 'Invalid Jellyfin authentication response')
    }
    const session = { accessToken: body.AccessToken, userId: body.User.Id }
    this.session = { ...session }
    return session
  }

  private userPath(): string {
    if (!this.userId || !this.accessToken) throw new JellyfinError(0, 'Jellyfin authentication required')
    return `/Users/${encodeURIComponent(this.userId)}`
  }

  private async items(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<JellyfinItem[]> {
    const body = await this.request(path, params)
    if (!isRecord(body) || !Array.isArray(body.Items) ||
        !body.Items.every((item: unknown) => isRecord(item) && typeof item.Id === 'string')) {
      throw new JellyfinError(200, 'Invalid Jellyfin items response')
    }
    return body.Items as JellyfinItem[]
  }

  getViews(): Promise<JellyfinItem[]> {
    return this.items(`${this.userPath()}/Views`)
  }

  getAlbums(parentId?: string, startIndex = 0, limit = 100): Promise<JellyfinItem[]> {
    return this.items(`${this.userPath()}/Items`, {
      IncludeItemTypes: 'MusicAlbum', Recursive: true, ParentId: parentId,
      StartIndex: startIndex, Limit: limit, SortBy: 'SortName', SortOrder: 'Ascending',
    })
  }

  getAlbumTracks(albumId: string): Promise<JellyfinItem[]> {
    return this.items(`${this.userPath()}/Items`, {
      IncludeItemTypes: 'Audio', ParentId: albumId, Recursive: true,
      SortBy: 'ParentIndexNumber,IndexNumber,SortName', SortOrder: 'Ascending',
    })
  }

  searchAudio(query: string): Promise<JellyfinItem[]> {
    return this.items(`${this.userPath()}/Items`, {
      IncludeItemTypes: 'Audio', Recursive: true, SearchTerm: query,
    })
  }

  private mediaUrl(path: string, params: Record<string, string | number | boolean | undefined> = {}): string {
    if (!this.accessToken) throw new JellyfinError(0, 'Jellyfin authentication required')
    return this.url(path, { api_key: this.accessToken, ...params })
  }

  streamUrl(itemId: string, staticStream = false): string {
    return this.mediaUrl(`/Audio/${encodeURIComponent(itemId)}/universal`, {
      Container: 'mp3,aac,m4a,flac,wav', UserId: this.userId, DeviceId: this.deviceId,
      ...(staticStream ? { static: true } : {}),
    })
  }

  downloadUrl(itemId: string): string {
    return this.mediaUrl(`/Items/${encodeURIComponent(itemId)}/Download`)
  }

  imageUrl(itemId: string, maxWidth?: number): string {
    return this.mediaUrl(`/Items/${encodeURIComponent(itemId)}/Images/Primary`, { maxWidth })
  }

  toTrackLike(item: JellyfinItem) { return toTrackLike(item) }
}
