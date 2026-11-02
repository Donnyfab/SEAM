import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectError, checkReachable, createAdapter, explainNetworkError } from '../src/connect/sources'

afterEach(() => vi.unstubAllGlobals())

describe('checkReachable', () => {
  it('blocks http servers from an https page', () => {
    expect(() => checkReachable('http://nas.local/dav', 'https:')).toThrow(/https/)
  })
  it('allows https servers and localhost', () => {
    expect(() => checkReachable('https://nas.example.com', 'https:')).not.toThrow()
    expect(() => checkReachable('http://localhost:8080', 'https:')).not.toThrow()
    expect(() => checkReachable('http://nas.local', 'http:')).not.toThrow()
  })
  it('rejects garbage', () => { expect(() => checkReachable('not a url', 'https:')).toThrow(ConnectError) })
})

describe('explainNetworkError', () => {
  it('translates opaque fetch failures into CORS/reachability advice', () => {
    expect(explainNetworkError(new TypeError('Load failed'))).toMatch(/CORS/)
    expect(explainNetworkError(new TypeError('Failed to fetch'))).toMatch(/CORS/)
  })
  it('passes other messages through', () => { expect(explainNetworkError(new Error('Server returned 500'))).toBe('Server returned 500') })
})

describe('webdav adapter', () => {
  const xml = (rows: string) => `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${rows}</d:multistatus>`
  const row = (href: string, dir: boolean, size = 0) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${dir ? '<d:resourcetype><d:collection/></d:resourcetype>' : '<d:resourcetype/>'}<d:getcontentlength>${size}</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
  it('lists folders first, hides non-audio files', async () => {
    vi.stubGlobal('location', { protocol: 'https:', hostname: 'x' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(xml(row('/dav/', true) + row('/dav/b.mp3', false, 10) + row('/dav/notes.txt', false, 5) + row('/dav/Albums/', true) + row('/dav/a.flac', false, 20)), { status: 207 })))
    const nodes = await createAdapter({ id: '1', kind: 'webdav', name: 'x', url: 'https://nas.example.com/dav' }).root()
    expect(nodes.map(n => n.title)).toEqual(['Albums', 'a.flac', 'b.mp3'])
    expect(nodes[0]!.container).toBe(true)
  })
})
