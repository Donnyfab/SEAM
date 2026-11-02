import { describe, expect, it } from 'vitest'
import { detectStreamKind, parseIcyMetaInt, parseM3U, parsePLS, parseStreamTitle } from '../src/connect/playlists'

describe('playlist parsing', () => {
  it('reads EXTINF, CRLF, BOM, comments, relative paths and comma-containing titles', () => {
    expect(parseM3U('\uFEFF#EXTM3U\r\n#EXTINF:123.5,Artist - Song, Live\r\n#comment\r\n ../song.mp3 \r\n\r\n#EXTINF:-1,Radio\r\nhttps://radio.test/live\r\nplain.mp3')).toEqual([
      { url: '../song.mp3', title: 'Artist - Song, Live', duration: 123.5 },
      { url: 'https://radio.test/live', title: 'Radio' }, { url: 'plain.mp3' },
    ])
  })
  it('ignores invalid durations and does not reuse metadata', () => {
    expect(parseM3U('#EXTINF:wat,Title\na\nb\n#EXTINF:0,\nc\n#EXTINF:2,orphan')).toEqual([
      { url: 'a', title: 'Title' }, { url: 'b' }, { url: 'c', duration: 0 },
    ])
    expect(parseM3U('')).toEqual([])
  })
  it('reads out-of-order, case-insensitive PLS fields in numeric order', () => {
    expect(parsePLS('[playlist]\r\nTitle10=Last\r\nFile10=https://radio.test/?a=b\r\nlength10=-1\r\nTitle2=Second\r\nLength2=12.5\r\nfile2=../two.mp3\r\nFile1=one.mp3\r\nLength1=0\r\nTitle3=orphan\r\nFile0=invalid\r\nNumberOfEntries=10')).toEqual([
      { url: 'one.mp3', duration: 0 }, { url: '../two.mp3', title: 'Second', duration: 12.5 },
      { url: 'https://radio.test/?a=b', title: 'Last' },
    ])
  })
  it('ignores empty files and invalid PLS durations', () => {
    expect(parsePLS('File1=\nTitle1=Empty\nFile2=two\nLength2=nope\nFile3=three\nLength3=')).toEqual([{ url: 'two' }, { url: 'three' }])
    expect(parsePLS('')).toEqual([])
  })
})

describe('ICY metadata', () => {
  it('extracts titles, apostrophes, empty titles and padded blocks', () => {
    expect(parseStreamTitle("StreamTitle='Artist - Title';StreamUrl='';\0\0")).toBe('Artist - Title')
    expect(parseStreamTitle("StreamUrl='x'; StreamTitle='Artist - Don't Stop';")).toBe("Artist - Don't Stop")
    expect(parseStreamTitle("StreamTitle='';")).toBe('')
    expect(parseStreamTitle("StreamUrl='x';")).toBeUndefined()
    expect(parseStreamTitle("StreamTitle='unfinished")).toBeUndefined()
  })
  it('parses only positive integer metadata intervals', () => {
    expect(parseIcyMetaInt(' 16000 ')).toBe(16000)
    for (const input of [undefined, null, '', '0', '-1', '1.5', '12junk', 'Infinity', '9007199254740992']) {
      expect(parseIcyMetaInt(input)).toBeNull()
    }
  })
})

describe('stream kind detection', () => {
  it.each([
    ['https://radio.test/list.M3U?token=x', undefined, 'm3u'],
    ['../list.m3u8#x', undefined, 'm3u'], ['radio.pls?x=y', 'text/plain', 'pls'],
    ['https://radio.test/live', 'Audio/X-MpegURL; charset=utf-8', 'm3u'],
    ['live', 'application/vnd.apple.mpegurl', 'm3u'], ['list.m3u', 'audio/x-scpls', 'pls'],
    ['https://radio.test/live?name=list.pls', 'audio/mpeg', 'direct'],
    ['song.mp3', null, 'direct'],
  ])('detects %s with MIME %s as %s', (url, mime, kind) => {
    expect(detectStreamKind(url, mime)).toBe(kind)
  })
})
