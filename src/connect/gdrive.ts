export interface GoogleDriveOptions {
  clientId: string
  accessToken?: string
  fetchFn?: typeof fetch
}

export interface GoogleDriveTokens {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  scope?: string
}

export interface GoogleDriveFile {
  id: string
  name: string
  mimeType: string
  size?: string
  modifiedTime?: string
}

export function isFolder(mimeType: string): boolean {
  return mimeType === 'application/vnd.google-apps.folder'
}

export class GoogleDriveClient {
  private accessToken?: string
  private readonly clientId: string
  private readonly fetchFn: typeof fetch

  constructor(options: GoogleDriveOptions) {
    this.clientId = options.clientId
    this.accessToken = options.accessToken
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis)
  }

  authorizeUrl({ redirectUri, challenge, state }: { redirectUri: string; challenge: string; state: string }): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.search = new URLSearchParams({ client_id: this.clientId, redirect_uri: redirectUri,
      response_type: 'code', scope: 'https://www.googleapis.com/auth/drive.readonly',
      code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline' }).toString()
    return url.toString()
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const response = await this.fetchFn(url, init)
    if (!response.ok) throw new Error(`Google Drive HTTP error ${response.status}`)
    return response
  }

  private async token(params: Record<string, string>): Promise<GoogleDriveTokens> {
    const response = await this.request('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, ...params }).toString(),
    })
    const tokens = await response.json() as GoogleDriveTokens
    if (!tokens || typeof tokens.access_token !== 'string' || !tokens.access_token) throw new Error('Invalid Google Drive token response')
    this.accessToken = tokens.access_token
    return tokens
  }

  exchangeCode({ code, verifier, redirectUri }: { code: string; verifier: string; redirectUri: string }): Promise<GoogleDriveTokens> {
    return this.token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri })
  }

  refresh(refreshToken: string): Promise<GoogleDriveTokens> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken })
  }

  private get(url: string): Promise<Response> {
    if (!this.accessToken) throw new Error('Google Drive access token required')
    return this.request(url, { method: 'GET', headers: { Authorization: `Bearer ${this.accessToken}` } })
  }

  async list(folderId = 'root', pageToken?: string): Promise<{ files: GoogleDriveFile[]; nextPageToken?: string }> {
    const url = new URL('https://www.googleapis.com/drive/v3/files')
    const escaped = folderId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    url.searchParams.set('q', `'${escaped}' in parents and trashed=false`)
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size,modifiedTime)')
    if (pageToken !== undefined) url.searchParams.set('pageToken', pageToken)
    return await (await this.get(url.toString())).json() as { files: GoogleDriveFile[]; nextPageToken?: string }
  }

  async downloadBlob(fileId: string): Promise<Blob> {
    return (await this.get(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`)).blob()
  }
}
