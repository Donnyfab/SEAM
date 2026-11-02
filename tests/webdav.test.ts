import { describe, expect, it, vi } from 'vitest'
import { WebDavClient, WebDavError, isAudioName } from '../src/connect/webdav'
import { parseXml } from '../src/connect/xml'

// Representative Nextcloud, Apache mod_dav, and Synology multistatus layouts.
const nextcloud = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
 <d:response><d:href>/remote.php/dav/files/alice/Music/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/files/alice/Music/Beyonc%C3%A9%20%26%20Jay%20%231.flac</d:href>
 <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>12345</d:getcontentlength><d:getlastmodified>Wed, 21 Oct 2015 07:28:00 GMT</d:getlastmodified><d:getcontenttype>audio/flac</d:getcontenttype><oc:fileid>99</oc:fileid></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
 <d:propstat><d:prop><d:displayname/><d:getetag/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>
</d:multistatus>`
const apache = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
 <D:response><D:href>https://dav.example/dav/Music</D:href><D:propstat><D:prop><D:resourcetype><D:collection /></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
 <D:response><D:href>/dav/Music/Live%20EP/</D:href><D:propstat><D:prop><D:displayname>Live &amp; &quot;EP&quot; &apos;24</D:displayname><D:resourcetype><D:collection /></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
 <D:response><D:href>/dav/Music/A%26B.mp3</D:href><D:propstat><D:prop><D:getcontentlength>42</D:getcontentlength><D:resourcetype /></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
</D:multistatus>`
const synology = `<multistatus xmlns="DAV:">
 <response><href>/dav/Music/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
 <response><href>Track%201.m4a</href><propstat><prop><displayname>Track &#49; &#x1F3B5; &lt;demo&gt;</displayname><resourcetype/><getcontentlength>98</getcontentlength><getlastmodified>invalid</getlastmodified></prop><status>HTTP/1.1 200 OK</status></propstat></response>
 <response><href>/dav/Music/A&amp;B.ogg</href><propstat><prop><displayname><![CDATA[A&B.ogg]]></displayname><getcontentlength>bad</getcontentlength></prop><status>HTTP/1.1 200 OK</status></propstat></response>
</multistatus>`

function setup(xml = apache, baseUrl = 'https://dav.example/dav///') {
  const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => new Response(xml, { status: 207 }))
  const client = new WebDavClient({ baseUrl, username: 'alice', password: 'secret', fetchFn })
  return { client, fetchFn }
}

describe('WebDavClient', () => {
  it('parses Nextcloud, skips self, decodes hrefs, and ignores failed property groups', async () => {
    const { client, fetchFn } = setup(nextcloud, 'https://dav.example/remote.php/dav/files/alice')
    expect(await client.list('/Music/')).toEqual([{
      name: 'Beyoncé & Jay #1.flac', path: '/Music/Beyoncé & Jay #1.flac', isDir: false,
      size: 12345, modified: Date.parse('2015-10-21T07:28:00Z'), contentType: 'audio/flac',
    }])
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('https://dav.example/remote.php/dav/files/alice/Music/')
    expect(init?.method).toBe('PROPFIND')
    const headers = new Headers(init?.headers)
    expect(headers.get('Depth')).toBe('1')
    expect(headers.get('Authorization')).toBe('Basic YWxpY2U6c2VjcmV0')
    expect(headers.get('Content-Type')).toContain('application/xml')
    expect(parseXml(String(init?.body)).name).toBe('propfind')
  })

  it('parses Apache uppercase prefixes, absolute hrefs, directories and named entities', async () => {
    expect(await setup().client.list('Music/')).toEqual([
      { name: 'Live & "EP" \'24', path: '/Music/Live EP', isDir: true, size: 0 },
      { name: 'A&B.mp3', path: '/Music/A&B.mp3', isDir: false, size: 42 },
    ])
  })

  it('parses Synology default namespaces, relative hrefs, numeric entities and CDATA', async () => {
    expect(await setup(synology).client.list('/Music')).toEqual([
      { name: 'Track 1 🎵 <demo>', path: '/Music/Track 1.m4a', isDir: false, size: 98 },
      { name: 'A&B.ogg', path: '/Music/A&B.ogg', isDir: false, size: 0 },
    ])
  })

  it('round-trips decoded paths and encodes reserved characters without losing the base path', async () => {
    const { client, fetchFn } = setup(nextcloud, 'https://dav.example/remote.php/dav/files/alice/')
    const [entry] = await client.list('Music')
    expect(client.fileUrl(entry!.path)).toBe('https://dav.example/remote.php/dav/files/alice/Music/Beyonc%C3%A9%20%26%20Jay%20%231.flac')
    expect(client.fileUrl('/100%/a?b+é.mp3')).toBe('https://dav.example/remote.php/dav/files/alice/100%25/a%3Fb%2B%C3%A9.mp3')
    expect(client.fileUrl('/')).toBe('https://dav.example/remote.php/dav/files/alice/')
    expect(fetchFn).toHaveBeenCalledOnce()
    expect(() => client.fileUrl('../secret')).toThrow('Invalid WebDAV path')
  })

  it('supports UTF-8 Basic credentials and anonymous access', async () => {
    const { fetchFn } = setup()
    const client = new WebDavClient({ baseUrl: 'https://dav.example', username: 'é', password: '密碼', fetchFn })
    expect(client.authHeader).toBe('Basic ' + Buffer.from('é:密碼').toString('base64'))
    const anonymous = new WebDavClient({ baseUrl: 'https://dav.example', fetchFn })
    expect(anonymous.authHeader).toBeUndefined()
    await anonymous.ping()
    expect(new Headers(fetchFn.mock.calls[0]![1]?.headers).has('Authorization')).toBe(false)
  })

  it('downloads a Blob with authorization', async () => {
    const { client, fetchFn } = setup()
    fetchFn.mockResolvedValueOnce(new Response(new Uint8Array([0, 1, 255]), { headers: { 'Content-Type': 'audio/mpeg' } }))
    const blob = await client.get('/Music/song.mp3')
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('audio/mpeg')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([0, 1, 255]))
    expect(fetchFn.mock.calls[0]![1]?.method).toBe('GET')
    expect(new Headers(fetchFn.mock.calls[0]![1]?.headers).get('Authorization')).toBe(client.authHeader)
  })

  it('pings using a Depth:0 PROPFIND on the configured root', async () => {
    const { client, fetchFn } = setup()
    await expect(client.ping()).resolves.toBeUndefined()
    expect(fetchFn.mock.calls[0]![0]).toBe('https://dav.example/dav/')
    expect(new Headers(fetchFn.mock.calls[0]![1]?.headers).get('Depth')).toBe('0')
  })

  it.each([401, 403, 404, 500])('exposes HTTP %i through typed errors for all requests', async status => {
    const { client, fetchFn } = setup()
    fetchFn.mockImplementation(async () => new Response('failure', { status }))
    for (const request of [() => client.list('/'), () => client.get('/song.mp3'), () => client.ping()]) {
      await expect(request()).rejects.toBeInstanceOf(WebDavError)
      await expect(request()).rejects.toMatchObject({ status, name: 'WebDavError' })
    }
  })

  it('rejects invalid XML and propagates network failures', async () => {
    const { client, fetchFn } = setup()
    for (const xml of ['', '<html/>', '<multistatus>', '<multistatus><response></multistatus>']) {
      fetchFn.mockResolvedValueOnce(new Response(xml, { status: 207 }))
      await expect(client.list('/')).rejects.toMatchObject({ status: 207, message: 'Invalid WebDAV multistatus XML' })
    }
    fetchFn.mockRejectedValueOnce(new TypeError('Network failed'))
    await expect(client.ping()).rejects.toThrow('Network failed')
  })

  it('accepts empty listings and filters failed, malformed, external and out-of-root hrefs', async () => {
    const records = [
      '<href>/dav/Music/no.mp3</href><status>HTTP/1.1 404 Not Found</status>',
      '<href>https://other.example/dav/Music/no.mp3</href>',
      '<href>/dav-other/no.mp3</href>', '<href>/dav/Music/%ZZ.mp3</href>', '',
    ].map(body => `<response>${body}<propstat><prop><resourcetype/></prop><status>HTTP/1.1 200 OK</status></propstat></response>`).join('')
    expect(await setup(`<multistatus>${records}</multistatus>`).client.list('Music')).toEqual([])
    expect(await setup('<multistatus/>').client.list('/')).toEqual([])
  })
})

describe('XML parser', () => {
  it('handles comments, declarations, quoted angle brackets and arbitrary namespace prefixes', () => {
    expect(parseXml('<?xml version="1.0"?><!--hi--><x:root xmlns:x="DAV:" a=">"><x:item>one &amp; two</x:item></x:root>')).toEqual({
      name: 'root', text: '', children: [{ name: 'item', text: 'one & two', children: [] }],
    })
  })
  it.each(['<!DOCTYPE root><root/>', '<a/><b/>', '<a></b>', '<a/>junk', '<a/><', '<a>'])('rejects unsupported or malformed documents: %s', xml => {
    expect(() => parseXml(xml)).toThrow()
  })
})

describe('isAudioName', () => {
  it.each(['song.MP3', 'song.m4a', 'book.m4b', 'song.aac', 'song.FLAC', 'song.wav', 'song.wave', 'song.ogg', 'song.oga', 'song.opus', 'song.aif', 'song.aiff', 'song.alac', 'song.wma'])('recognizes %s', name => {
    expect(isAudioName(name)).toBe(true)
  })
  it.each(['', 'mp3', 'song.mp3.txt', 'cover.jpg', 'song.mp3/'])('excludes %s', name => {
    expect(isAudioName(name)).toBe(false)
  })
})
