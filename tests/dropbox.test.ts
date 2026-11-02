import { describe, expect, it, vi } from 'vitest'
import { DropboxClient } from '../src/connect/dropbox'

function setup(body: unknown = {}, status = 200, accessToken: string | undefined = 'access') {
  const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(body), { status }))
  const client = new DropboxClient({ clientId: 'client +&', accessToken, fetchFn })
  return { client, fetchFn }
}

const callback = { redirectUri: 'https://seam.example/callback?x=1&y=2', challenge: 'challenge-_', state: 'state +&' }

describe('DropboxClient OAuth', () => {
  it('builds an encoded authorization URL with PKCE', () => {
    const { client, fetchFn } = setup()
    const url = new URL(client.authorizeUrl(callback))
    expect(url.origin + url.pathname).toBe('https://www.dropbox.com/oauth2/authorize')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client +&', redirect_uri: callback.redirectUri, response_type: 'code',
      code_challenge: callback.challenge, code_challenge_method: 'S256', state: callback.state,
    })
    expect(url.searchParams.get('token_access_type')).toBe('offline')
    expect(url.searchParams.has('client_secret')).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('exchanges an encoded code and verifier without a client secret', async () => {
    const tokens = { access_token: 'new-access', token_type: 'bearer', refresh_token: 'refresh', expires_in: 3600 }
    const { client, fetchFn } = setup(tokens)
    expect(await client.exchangeCode({ ...callback, code: 'code +&=', verifier: 'verifier_-~' })).toEqual(tokens)
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('https://api.dropboxapi.com/oauth2/token')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded')
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      client_id: 'client +&', grant_type: 'authorization_code', code: 'code +&=',
      code_verifier: 'verifier_-~', redirect_uri: callback.redirectUri,
    })
    fetchFn.mockResolvedValueOnce(new Response(JSON.stringify({ entries: [], cursor: 'cursor', has_more: false })))
    await client.listFolder('')
    expect(new Headers(fetchFn.mock.calls[1]![1]?.headers).get('Authorization')).toBe('Bearer new-access')
  })

  it('refreshes tokens and uses the new token for subsequent requests', async () => {
    const { client, fetchFn } = setup({ access_token: 'refreshed', token_type: 'bearer' })
    await client.refresh('refresh +&=')
    expect(fetchFn.mock.calls[0]![0]).toBe('https://api.dropboxapi.com/oauth2/token')
    expect(Object.fromEntries(new URLSearchParams(String(fetchFn.mock.calls[0]![1]?.body)))).toEqual({
      client_id: 'client +&', grant_type: 'refresh_token', refresh_token: 'refresh +&=',
    })
    fetchFn.mockResolvedValueOnce(new Response(JSON.stringify({ entries: [], cursor: 'cursor', has_more: false })))
    await client.listFolder('')
    expect(new Headers(fetchFn.mock.calls[1]![1]?.headers).get('Authorization')).toBe('Bearer refreshed')
  })

  it('rejects failed token requests and invalid token payloads', async () => {
    const { client, fetchFn } = setup({ error: 'invalid_grant' }, 400)
    await expect(client.refresh('expired')).rejects.toThrow('HTTP error 400')
    for (const body of [null, {}, { access_token: '' }, { access_token: 123 }]) {
      fetchFn.mockResolvedValueOnce(new Response(JSON.stringify(body)))
      await expect(client.refresh('refresh')).rejects.toThrow('Invalid Dropbox token response')
    }
  })

  it('rejects unauthenticated requests before fetching', async () => {
    const fetchFn = vi.fn<typeof fetch>()
    const client = new DropboxClient({ clientId: 'id', fetchFn })
    await expect(client.listFolder('')).rejects.toThrow('access token required')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('propagates HTTP, malformed JSON, and network failures', async () => {
    const { client, fetchFn } = setup({}, 503)
    await expect(client.listFolder('')).rejects.toThrow('HTTP error 503')
    fetchFn.mockResolvedValueOnce(new Response('not json'))
    await expect(client.listFolder('')).rejects.toThrow()
    fetchFn.mockRejectedValueOnce(new TypeError('Network failed'))
    await expect(client.listFolder('')).rejects.toThrow('Network failed')
  })
})

it('maps Dropbox folders and files and returns pagination metadata', async () => {
  const { client, fetchFn } = setup({ entries: [
    { '.tag': 'folder', id: 'd', name: 'Music', path_display: '/Music' },
    { '.tag': 'file', id: 'f', name: 'a.mp3', path_lower: '/music/a.mp3', size: 42, server_modified: '2026-01-01T00:00:00Z' },
    { '.tag': 'deleted', name: 'gone' },
  ], cursor: 'next+&', has_more: true })
  expect(await client.listFolder('/Music +&')).toEqual({ entries: [
    { id: 'd', name: 'Music', path: '/Music', isDir: true },
    { id: 'f', name: 'a.mp3', path: '/music/a.mp3', isDir: false, size: 42, modified: '2026-01-01T00:00:00Z' },
  ], cursor: 'next+&', hasMore: true })
  expect(fetchFn.mock.calls[0]![0]).toBe('https://api.dropboxapi.com/2/files/list_folder')
  expect(JSON.parse(String(fetchFn.mock.calls[0]![1]?.body))).toEqual({ path: '/Music +&' })
  await client.listFolder('/ignored', 'next+&')
  expect(fetchFn.mock.calls[1]![0]).toBe('https://api.dropboxapi.com/2/files/list_folder/continue')
  expect(JSON.parse(String(fetchFn.mock.calls[1]![1]?.body))).toEqual({ cursor: 'next+&' })
  expect(new Headers(fetchFn.mock.calls[0]![1]?.headers).get('Content-Type')).toBe('application/json')
})

it('fetches temporary links with bearer authentication', async () => {
  const { client, fetchFn } = setup({ link: 'https://download.example/file' })
  expect(await client.temporaryLink('/Music/a.mp3')).toBe('https://download.example/file')
  expect(fetchFn.mock.calls[0]![0]).toBe('https://api.dropboxapi.com/2/files/get_temporary_link')
  expect(JSON.parse(String(fetchFn.mock.calls[0]![1]?.body))).toEqual({ path: '/Music/a.mp3' })
  expect(new Headers(fetchFn.mock.calls[0]![1]?.headers).get('Authorization')).toBe('Bearer access')
})

it('preserves typed Dropbox errors including non-JSON error bodies', async () => {
  const { DropboxError } = await import('../src/connect/dropbox')
  const { client, fetchFn } = setup({ error_summary: 'path/not_found' }, 409)
  await expect(client.listFolder('/missing')).rejects.toBeInstanceOf(DropboxError)
  await expect(client.listFolder('/missing')).rejects.toMatchObject({ status: 409, details: { error_summary: 'path/not_found' } })
  fetchFn.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
  await expect(client.temporaryLink('/file')).rejects.toMatchObject({ status: 503, details: 'Unavailable' })
})
