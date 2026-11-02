export interface OneDriveOptions {
  clientId: string
  accessToken?: string
  fetchFn?: typeof fetch
}

export interface OneDriveTokens {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  scope?: string
}

export interface OneDriveEntry {
  id: string
  name: string
  isDir: boolean
  size: number
  downloadUrl?: string
}

interface ChildrenResponse {
  value: { id: string; name: string; folder?: { childCount?: number }; size: number; '@microsoft.graph.downloadUrl'?: string }[]
  '@odata.nextLink'?: string
}

const authority = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const graph = 'https://graph.microsoft.com/v1.0'

export class OneDriveClient {
  private accessToken?: string
  private readonly clientId: string
  private readonly fetchFn: typeof fetch

  constructor(options: OneDriveOptions) {
    this.clientId = options.clientId
    this.accessToken = options.accessToken
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis)
  }

  authorizeUrl({ redirectUri, challenge, state }: { redirectUri: string; challenge: string; state: string }): string {
    const url = new URL(`${authority}/authorize`)
    url.search = new URLSearchParams({ client_id: this.clientId, redirect_uri: redirectUri,
      response_type: 'code', scope: 'Files.Read offline_access', code_challenge: challenge,
      code_challenge_method: 'S256', state }).toString()
    return url.toString()
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const response = await this.fetchFn(url, init)
    if (!response.ok) throw new Error(`OneDrive HTTP error ${response.status}`)
    return response
  }

  private async token(params: Record<string, string>): Promise<OneDriveTokens> {
    const response = await this.request(`${authority}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, ...params }).toString(),
    })
    const tokens = await response.json() as OneDriveTokens
    if (!tokens || typeof tokens.access_token !== 'string' || !tokens.access_token) throw new Error('Invalid OneDrive token response')
    this.accessToken = tokens.access_token
    return tokens
  }

  exchangeCode({ code, verifier, redirectUri }: { code: string; verifier: string; redirectUri: string }): Promise<OneDriveTokens> {
    return this.token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri })
  }

  refresh(refreshToken: string): Promise<OneDriveTokens> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken })
  }

  private get(url: string): Promise<Response> {
    if (!this.accessToken) throw new Error('OneDrive access token required')
    return this.request(url, { method: 'GET', headers: { Authorization: `Bearer ${this.accessToken}` } })
  }

  async listChildren(itemId = 'root', nextLink?: string): Promise<{ entries: OneDriveEntry[]; nextLink?: string }> {
    const url = nextLink === undefined
      ? new URL(itemId === 'root' ? `${graph}/me/drive/root/children` : `${graph}/me/drive/items/${encodeURIComponent(itemId)}/children`)
      : new URL(nextLink)
    // Pagination URLs carry bearer credentials, so only accept this Graph API origin/path.
    if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/') || url.username || url.password) {
      throw new Error('Invalid OneDrive nextLink')
    }
    const result = await (await this.get(url.toString())).json() as ChildrenResponse
    return {
      entries: result.value.map(entry => ({ id: entry.id, name: entry.name, size: entry.size,
        isDir: entry.folder !== undefined, downloadUrl: entry['@microsoft.graph.downloadUrl'] })),
      nextLink: result['@odata.nextLink'],
    }
  }

  async download(itemId: string): Promise<Blob> {
    return (await this.get(`${graph}/me/drive/items/${encodeURIComponent(itemId)}/content`)).blob()
  }
}
