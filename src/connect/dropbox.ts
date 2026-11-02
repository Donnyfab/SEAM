export interface DropboxOptions {
  clientId: string
  accessToken?: string
  fetchFn?: typeof fetch
}

export interface DropboxTokens {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  scope?: string
}

export interface DropboxEntry {
  id: string
  name: string
  path: string
  isDir: boolean
  size?: number
  modified?: string
}

export class DropboxError extends Error {
  constructor(public readonly status: number, public readonly details: unknown) {
    super(`Dropbox HTTP error ${status}`)
    this.name = 'DropboxError'
  }
}

interface FolderResponse {
  entries: { '.tag': string; id: string; name: string; path_display?: string; path_lower?: string; size?: number; server_modified?: string }[]
  cursor: string
  has_more: boolean
}

export class DropboxClient {
  private accessToken?: string
  private readonly fetchFn: typeof fetch
  private readonly clientId: string

  constructor(options: DropboxOptions) {
    this.clientId = options.clientId
    this.accessToken = options.accessToken
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis)
  }

  authorizeUrl({ redirectUri, challenge, state }: { redirectUri: string; challenge: string; state: string }): string {
    const url = new URL('https://www.dropbox.com/oauth2/authorize')
    url.search = new URLSearchParams({ client_id: this.clientId, redirect_uri: redirectUri,
      response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state,
      token_access_type: 'offline' }).toString()
    return url.toString()
  }

  private async json<T>(url: string, init: RequestInit): Promise<T> {
    const response = await this.fetchFn(url, init)
    if (!response.ok) {
      const text = await response.text()
      let details: unknown = text
      try { details = JSON.parse(text) as unknown } catch { /* Non-JSON HTTP errors retain their text. */ }
      throw new DropboxError(response.status, details)
    }
    return await response.json() as T
  }

  private async token(params: Record<string, string>): Promise<DropboxTokens> {
    const tokens = await this.json<DropboxTokens>('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, ...params }).toString(),
    })
    if (!tokens || typeof tokens.access_token !== 'string' || !tokens.access_token) throw new Error('Invalid Dropbox token response')
    this.accessToken = tokens.access_token
    return tokens
  }

  exchangeCode({ code, verifier, redirectUri }: { code: string; verifier: string; redirectUri: string }): Promise<DropboxTokens> {
    return this.token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri })
  }

  refresh(refreshToken: string): Promise<DropboxTokens> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken })
  }

  private rpc<T>(method: string, body: Record<string, string>): Promise<T> {
    if (!this.accessToken) throw new Error('Dropbox access token required')
    return this.json<T>(`https://api.dropboxapi.com/2/files/${method}`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async listFolder(path: string, cursor?: string): Promise<{ entries: DropboxEntry[]; cursor: string; hasMore: boolean }> {
    const result = await this.rpc<FolderResponse>(cursor === undefined ? 'list_folder' : 'list_folder/continue',
      cursor === undefined ? { path } : { cursor })
    return {
      entries: result.entries.filter(entry => entry['.tag'] !== 'deleted').map(entry => ({
        id: entry.id, name: entry.name, path: entry.path_display ?? entry.path_lower ?? '',
        isDir: entry['.tag'] === 'folder', size: entry.size, modified: entry.server_modified,
      })),
      cursor: result.cursor, hasMore: result.has_more,
    }
  }

  async temporaryLink(path: string): Promise<string> {
    return (await this.rpc<{ link: string }>('get_temporary_link', { path })).link
  }
}
