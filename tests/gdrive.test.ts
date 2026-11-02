import { describe, expect, it, vi } from 'vitest'
import { GoogleDriveClient } from '../src/connect/gdrive'

function setup(body: unknown = {}, status = 200, accessToken: string | undefined = 'access') {
  const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(body), { status }))
  const client = new GoogleDriveClient({ clientId: 'client +&', accessToken, fetchFn })
  return { client, fetchFn }
}

const callback = { redirectUri: 'https://seam.example/callback?x=1&y=2', challenge: 'challenge-_', state: 'state +&' }

describe('GoogleDriveClient OAuth', () => {
  it('builds an encoded authorization URL with PKCE', () => {
    const { client, fetchFn } = setup()
    const url = new URL(client.authorizeUrl(callback))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client +&', redirect_uri: callback.redirectUri, response_type: 'code',
      code_challenge: callback.challenge, code_challenge_method: 'S256', state: callback.state,
    })
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.readonly')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.has('client_secret')).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('exchanges an encoded code and verifier without a client secret', async () => {
    const tokens = { access_token: 'new-access', token_type: 'bearer', refresh_token: 'refresh', expires_in: 3600 }
    const { client, fetchFn } = setup(tokens)
    expect(await client.exchangeCode({ ...callback, code: 'code +&=', verifier: 'verifier_-~' })).toEqual(tokens)
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded')
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      client_id: 'client +&', grant_type: 'authorization_code', code: 'code +&=',
      code_verifier: 'verifier_-~', redirect_uri: callback.redirectUri,
    })
    fetchFn.mockResolvedValueOnce(new Response(JSON.stringify({ files: [] })))
    await client.list()
    expect(new Headers(fetchFn.mock.calls[1]![1]?.headers).get('Authorization')).toBe('Bearer new-access')
  })

  it('refreshes tokens and uses the new token for subsequent requests', async () => {
    const { client, fetchFn } = setup({ access_token: 'refreshed', token_type: 'bearer' })
    await client.refresh('refresh +&=')
    expect(fetchFn.mock.calls[0]![0]).toBe('https://oauth2.googleapis.com/token')
    expect(Object.fromEntries(new URLSearchParams(String(fetchFn.mock.calls[0]![1]?.body)))).toEqual({
      client_id: 'client +&', grant_type: 'refresh_token', refresh_token: 'refresh +&=',
    })
    fetchFn.mockResolvedValueOnce(new Response(JSON.stringify({ files: [] })))
    await client.list()
    expect(new Headers(fetchFn.mock.calls[1]![1]?.headers).get('Authorization')).toBe('Bearer refreshed')
  })

  it('rejects failed token requests and invalid token payloads', async () => {
    const { client, fetchFn } = setup({ error: 'invalid_grant' }, 400)
    await expect(client.refresh('expired')).rejects.toThrow('HTTP error 400')
    for (const body of [null, {}, { access_token: '' }, { access_token: 123 }]) {
      fetchFn.mockResolvedValueOnce(new Response(JSON.stringify(body)))
      await expect(client.refresh('refresh')).rejects.toThrow('Invalid Google Drive token response')
    }
  })

  it('rejects unauthenticated requests before fetching', async () => {
    const fetchFn = vi.fn<typeof fetch>()
    const client = new GoogleDriveClient({ clientId: 'id', fetchFn })
    await expect(client.list()).rejects.toThrow('access token required')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('propagates HTTP, malformed JSON, and network failures', async () => {
    const { client, fetchFn } = setup({}, 503)
    await expect(client.list()).rejects.toThrow('HTTP error 503')
    fetchFn.mockResolvedValueOnce(new Response('not json'))
    await expect(client.list()).rejects.toThrow()
    fetchFn.mockRejectedValueOnce(new TypeError('Network failed'))
    await expect(client.list()).rejects.toThrow('Network failed')
  })
})

it('lists Drive files with a field mask, escaped folder query and pagination', async () => {
  const files = [{ id: 'f', name: 'Music', mimeType: 'application/vnd.google-apps.folder' },
    { id: 'a', name: 'a.mp3', mimeType: 'audio/mpeg', size: '42', modifiedTime: '2026-01-01T00:00:00Z' }]
  const { client, fetchFn } = setup({ files, nextPageToken: 'next +&' })
  expect(await client.list()).toEqual({ files, nextPageToken: 'next +&' })
  const url = new URL(String(fetchFn.mock.calls[0]![0]))
  expect(url.origin + url.pathname).toBe('https://www.googleapis.com/drive/v3/files')
  expect(url.searchParams.get('q')).toBe("'root' in parents and trashed=false")
  expect(url.searchParams.get('fields')).toBe('nextPageToken,files(id,name,mimeType,size,modifiedTime)')
  expect(url.searchParams.has('pageToken')).toBe(false)
  await client.list("a'\\b", 'next +&')
  const next = new URL(String(fetchFn.mock.calls[1]![0]))
  expect(next.searchParams.get('q')).toBe("'a\\'\\\\b' in parents and trashed=false")
  expect(next.searchParams.get('pageToken')).toBe('next +&')
  expect(fetchFn.mock.calls[0]![1]?.method).toBe('GET')
})

it('downloads a Blob with alt=media and bearer authentication', async () => {
  const { client, fetchFn } = setup()
  fetchFn.mockResolvedValueOnce(new Response('audio bytes', { headers: { 'Content-Type': 'audio/mpeg' } }))
  const blob = await client.downloadBlob('id /?&')
  expect(await blob.text()).toBe('audio bytes')
  expect(blob.type).toBe('audio/mpeg')
  expect(fetchFn.mock.calls[0]![0]).toBe('https://www.googleapis.com/drive/v3/files/id%20%2F%3F%26?alt=media')
  expect(new Headers(fetchFn.mock.calls[0]![1]?.headers).get('Authorization')).toBe('Bearer access')
  fetchFn.mockResolvedValueOnce(new Response('', { status: 403 }))
  await expect(client.downloadBlob('denied')).rejects.toThrow('HTTP error 403')
})

it('identifies only the exact Drive folder MIME type', async () => {
  const { isFolder } = await import('../src/connect/gdrive')
  expect(isFolder('application/vnd.google-apps.folder')).toBe(true)
  expect(isFolder('audio/mpeg')).toBe(false)
  expect(isFolder('')).toBe(false)
})
