import { describe, expect, it, vi } from 'vitest'
import { OneDriveClient } from '../src/connect/onedrive'

function setup(body: unknown = {}, status = 200, accessToken: string | undefined = 'access') {
  const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(body), { status }))
  const client = new OneDriveClient({ clientId: 'client +&', accessToken, fetchFn })
  return { client, fetchFn }
}

const callback = { redirectUri: 'https://seam.example/callback?x=1&y=2', challenge: 'challenge-_', state: 'state +&' }

describe('OneDriveClient OAuth', () => {
  it('builds an encoded authorization URL with PKCE', () => {
    const { client, fetchFn } = setup()
    const url = new URL(client.authorizeUrl(callback))
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client +&', redirect_uri: callback.redirectUri, response_type: 'code',
      code_challenge: callback.challenge, code_challenge_method: 'S256', state: callback.state,
    })
    expect(url.searchParams.get('scope')).toBe('Files.Read offline_access')
    expect(url.searchParams.has('client_secret')).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('exchanges an encoded code and verifier without a client secret', async () => {
    const tokens = { access_token: 'new-access', token_type: 'bearer', refresh_token: 'refresh', expires_in: 3600 }
    const { client, fetchFn } = setup(tokens)
    expect(await client.exchangeCode({ ...callback, code: 'code +&=', verifier: 'verifier_-~' })).toEqual(tokens)
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded')
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      client_id: 'client +&', grant_type: 'authorization_code', code: 'code +&=',
      code_verifier: 'verifier_-~', redirect_uri: callback.redirectUri,
    })
    fetchFn.mockResolvedValueOnce(new Response(JSON.stringify({ value: [] })))
    await client.listChildren()
    expect(new Headers(fetchFn.mock.calls[1]![1]?.headers).get('Authorization')).toBe('Bearer new-access')
  })

  it('refreshes tokens and uses the new token for subsequent requests', async () => {
    const { client, fetchFn } = setup({ access_token: 'refreshed', token_type: 'bearer' })
    await client.refresh('refresh +&=')
    expect(fetchFn.mock.calls[0]![0]).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token')
    expect(Object.fromEntries(new URLSearchParams(String(fetchFn.mock.calls[0]![1]?.body)))).toEqual({
      client_id: 'client +&', grant_type: 'refresh_token', refresh_token: 'refresh +&=',
    })
    fetchFn.mockResolvedValueOnce(new Response(JSON.stringify({ value: [] })))
    await client.listChildren()
    expect(new Headers(fetchFn.mock.calls[1]![1]?.headers).get('Authorization')).toBe('Bearer refreshed')
  })

  it('rejects failed token requests and invalid token payloads', async () => {
    const { client, fetchFn } = setup({ error: 'invalid_grant' }, 400)
    await expect(client.refresh('expired')).rejects.toThrow('HTTP error 400')
    for (const body of [null, {}, { access_token: '' }, { access_token: 123 }]) {
      fetchFn.mockResolvedValueOnce(new Response(JSON.stringify(body)))
      await expect(client.refresh('refresh')).rejects.toThrow('Invalid OneDrive token response')
    }
  })

  it('rejects unauthenticated requests before fetching', async () => {
    const fetchFn = vi.fn<typeof fetch>()
    const client = new OneDriveClient({ clientId: 'id', fetchFn })
    await expect(client.listChildren()).rejects.toThrow('access token required')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('propagates HTTP, malformed JSON, and network failures', async () => {
    const { client, fetchFn } = setup({}, 503)
    await expect(client.listChildren()).rejects.toThrow('HTTP error 503')
    fetchFn.mockResolvedValueOnce(new Response('not json'))
    await expect(client.listChildren()).rejects.toThrow()
    fetchFn.mockRejectedValueOnce(new TypeError('Network failed'))
    await expect(client.listChildren()).rejects.toThrow('Network failed')
  })
})

it('lists root or encoded item children, maps facets, and preserves nextLink', async () => {
  const nextLink = 'https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=next%2B'
  const { client, fetchFn } = setup({ value: [
    { id: 'd', name: 'Music', folder: { childCount: 0 }, size: 0 },
    { id: 'a', name: 'a.mp3', size: 42, '@microsoft.graph.downloadUrl': 'https://download.example/a' },
  ], '@odata.nextLink': nextLink })
  expect(await client.listChildren()).toEqual({ entries: [
    { id: 'd', name: 'Music', isDir: true, size: 0 },
    { id: 'a', name: 'a.mp3', isDir: false, size: 42, downloadUrl: 'https://download.example/a' },
  ], nextLink })
  expect(fetchFn.mock.calls[0]![0]).toBe('https://graph.microsoft.com/v1.0/me/drive/root/children')
  await client.listChildren('id /?&')
  expect(fetchFn.mock.calls[1]![0]).toBe('https://graph.microsoft.com/v1.0/me/drive/items/id%20%2F%3F%26/children')
  await client.listChildren('ignored', nextLink)
  expect(fetchFn.mock.calls[2]![0]).toBe(nextLink)
  expect(fetchFn.mock.calls[2]![1]?.method).toBe('GET')
})

it('rejects pagination URLs outside Graph before sending a bearer token', async () => {
  const { client, fetchFn } = setup()
  for (const nextLink of ['https://evil.example/v1.0/files', 'http://graph.microsoft.com/v1.0/files', 'https://graph.microsoft.com.evil.example/v1.0/files', 'https://user@graph.microsoft.com/v1.0/files']) {
    await expect(client.listChildren('root', nextLink)).rejects.toThrow('Invalid OneDrive nextLink')
  }
  expect(fetchFn).not.toHaveBeenCalled()
})

it('downloads content as a Blob with bearer authentication', async () => {
  const { client, fetchFn } = setup()
  fetchFn.mockResolvedValueOnce(new Response('audio bytes'))
  expect(await (await client.download('id /?&')).text()).toBe('audio bytes')
  expect(fetchFn.mock.calls[0]![0]).toBe('https://graph.microsoft.com/v1.0/me/drive/items/id%20%2F%3F%26/content')
  expect(new Headers(fetchFn.mock.calls[0]![1]?.headers).get('Authorization')).toBe('Bearer access')
  fetchFn.mockResolvedValueOnce(new Response('', { status: 404 }))
  await expect(client.download('missing')).rejects.toThrow('HTTP error 404')
})
