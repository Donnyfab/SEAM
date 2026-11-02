import { describe, expect, it } from 'vitest'
import { writeTags, type TagEdits } from '../src/library/tagwriter'

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
function concat(...parts: Uint8Array[]): Uint8Array {
  return Uint8Array.from(parts.flatMap(part => [...part]))
}
function size(value: number, length = 4, base = 256): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => Math.floor(value / base ** (length - i - 1)) % base)
}
const audio = Uint8Array.of(255, 251, 144, 0, 13, 27, 0, 255, 42)
const cover = Uint8Array.of(255, 216, 0, 99, 255, 217)
const edits: TagEdits = {
  title: 'Été 🎵', artist: '演奏者', albumArtist: 'Various', album: 'EP',
  genre: 'Electronic', composer: 'Composer', year: 2026, trackNo: 2,
  comment: 'Notes\nsecond line', lyrics: '歌詞\nwords', artwork: { mime: 'image/jpeg', data: cover },
}
function written(file: Uint8Array, values: TagEdits = edits, format: 'mp3' | 'flac' = 'mp3'): Uint8Array {
  const result = writeTags(file, values)
  if ('error' in result) throw new Error(result.error)
  expect(result.format).toBe(format)
  return result.bytes
}

// These readers interpret the binary layouts independently of the writer helpers.
function readMp3(file: Uint8Array) {
  expect([...file.slice(0, 6)]).toEqual([73, 68, 51, 4, 0, 0])
  const synchsafe = (offset: number): number => {
    const bytes = file.slice(offset, offset + 4)
    expect(bytes.every(byte => byte < 128)).toBe(true)
    return bytes.reduce((n, byte) => n * 128 + byte, 0)
  }
  const end = 10 + synchsafe(6)
  const frames: Record<string, Uint8Array> = {}
  let offset = 10
  while (offset < end) {
    const id = decode(file.slice(offset, offset + 4))
    const length = synchsafe(offset + 4)
    expect(file.slice(offset + 8, offset + 10)).toEqual(Uint8Array.of(0, 0))
    expect(length).toBeGreaterThan(0)
    expect(offset + 10 + length).toBeLessThanOrEqual(end)
    expect(frames[id]).toBeUndefined()
    frames[id] = file.slice(offset + 10, offset + 10 + length)
    offset += 10 + length
  }
  expect(offset).toBe(end)
  return { frames, audio: file.slice(end) }
}

function block(type: number, body: Uint8Array, last = false): Uint8Array {
  return concat(Uint8Array.of(type | (last ? 128 : 0)), size(body.length, 3), body)
}
const streaminfo = Uint8Array.from({ length: 34 }, (_, i) => i)
const flac = concat(encode('fLaC'), block(0, streaminfo, true), audio)
function readFlac(file: Uint8Array) {
  expect(decode(file.slice(0, 4))).toBe('fLaC')
  const blocks: { type: number; body: Uint8Array; last: boolean }[] = []
  let offset = 4
  while (true) {
    expect(offset + 4).toBeLessThanOrEqual(file.length)
    const flags = file[offset]!
    const length = file[offset + 1]! * 65536 + file[offset + 2]! * 256 + file[offset + 3]!
    expect(offset + 4 + length).toBeLessThanOrEqual(file.length)
    blocks.push({ type: flags & 127, body: file.slice(offset + 4, offset + 4 + length), last: !!(flags & 128) })
    offset += 4 + length
    if (flags & 128) break
  }
  const comment = blocks.find(item => item.type === 4)!.body
  const view = new DataView(comment.buffer, comment.byteOffset, comment.byteLength)
  let cursor = 0
  const number = (): number => { const n = view.getUint32(cursor, true); cursor += 4; return n }
  const string = (): string => { const n = number(); const s = decode(comment.slice(cursor, cursor + n)); cursor += n; return s }
  const vendor = string()
  const count = number()
  const comments: Record<string, string> = {}
  for (let i = 0; i < count; i++) {
    const entry = string()
    const equals = entry.indexOf('=')
    comments[entry.slice(0, equals)] = entry.slice(equals + 1)
  }
  expect(cursor).toBe(comment.length)
  const picture = blocks.find(item => item.type === 6)?.body
  let artwork: { type: number; mime: string; data: Uint8Array } | undefined
  if (picture) {
    const pv = new DataView(picture.buffer, picture.byteOffset, picture.byteLength)
    const mimeLength = pv.getUint32(4)
    const descriptionOffset = 8 + mimeLength
    const descriptionLength = pv.getUint32(descriptionOffset)
    const dataLengthOffset = descriptionOffset + 4 + descriptionLength + 16
    const dataLength = pv.getUint32(dataLengthOffset)
    expect(dataLengthOffset + 4 + dataLength).toBe(picture.length)
    artwork = { type: pv.getUint32(0), mime: decode(picture.slice(8, descriptionOffset)), data: picture.slice(dataLengthOffset + 4) }
  }
  return { blocks, comments, vendor, artwork, audio: file.slice(offset) }
}

describe('MP3 tag writing', () => {
  it.each([3, 4])('replaces v2.%i tags and round trips twice without touching audio or ID3v1', version => {
    const oldTag = concat(encode('ID3'), Uint8Array.of(version, 0, 0), size(140, 4, 128), new Uint8Array(140).fill(55))
    const id3v1 = concat(encode('TAG'), new Uint8Array(125).fill(71))
    const input = concat(oldTag, audio, id3v1)
    const snapshot = input.slice()
    const output = written(input)
    const parsed = readMp3(output)
    expect(input).toEqual(snapshot)
    expect(parsed.audio).toEqual(concat(audio, id3v1))
    const names = ['TIT2', 'TPE1', 'TPE2', 'TALB', 'TCON', 'TCOM', 'TDRC', 'TRCK', 'COMM', 'USLT', 'APIC']
    expect(Object.keys(parsed.frames)).toEqual(names)
    const values = [edits.title, edits.artist, edits.albumArtist, edits.album, edits.genre, edits.composer, '2026', '2', edits.comment, edits.lyrics]
    names.slice(0, 10).forEach((name, i) => {
      const body = parsed.frames[name]!
      expect(body[0]).toBe(3)
      if (name === 'COMM' || name === 'USLT') expect([...body.slice(1, 5)]).toEqual([101, 110, 103, 0])
      expect(decode(body.slice(name === 'COMM' || name === 'USLT' ? 5 : 1))).toBe(values[i])
    })
    expect(parsed.frames.APIC).toEqual(concat(Uint8Array.of(3), encode('image/jpeg'), Uint8Array.of(0, 3, 0), cover))
    expect(written(output)).toEqual(output)
    expect(written(written(output))).toEqual(output)
  })

  it('supports untagged MP3, empty values, zero numbers, and frame sizes over 127', () => {
    const output = written(audio, { title: 'a'.repeat(200), comment: '', year: 0, trackNo: 0 })
    const parsed = readMp3(output)
    expect(parsed.frames.TIT2!.length).toBe(201)
    expect(decode(parsed.frames.TDRC!.slice(1))).toBe('0')
    expect(decode(parsed.frames.TRCK!.slice(1))).toBe('0')
    expect(parsed.frames.COMM!.length).toBe(5)
    expect(parsed.audio).toEqual(audio)
    expect(readMp3(written(output, {})).frames).toEqual({})
  })

  it('discards a v2.4 footer and extended/unsynchronised old tag', () => {
    const flags = 0xd0
    const header = concat(encode('ID3'), Uint8Array.of(4, 0, flags), size(130, 4, 128))
    const footer = concat(encode('3DI'), header.slice(3))
    const input = concat(header, new Uint8Array(130), footer, audio)
    expect(readMp3(written(input)).audio).toEqual(audio)
    input[140] = 0
    expect(writeTags(input, {})).toHaveProperty('error')
  })
})

describe('FLAC tag writing', () => {
  it('inserts comments and artwork, preserving STREAMINFO/audio, and round trips twice', () => {
    const snapshot = flac.slice()
    const output = written(flac, edits, 'flac')
    const parsed = readFlac(output)
    expect(flac).toEqual(snapshot)
    expect(parsed.vendor).toBe('SEAM')
    expect(parsed.comments).toEqual({ TITLE: edits.title, ARTIST: edits.artist, ALBUMARTIST: edits.albumArtist,
      ALBUM: edits.album, GENRE: edits.genre, COMPOSER: edits.composer, DATE: '2026', TRACKNUMBER: '2',
      COMMENT: edits.comment, LYRICS: edits.lyrics })
    expect(parsed.artwork).toEqual({ type: 3, mime: 'image/jpeg', data: cover })
    expect(parsed.blocks.map(item => [item.type, item.last])).toEqual([[0, false], [4, false], [6, true]])
    expect(parsed.blocks[0]!.body).toEqual(streaminfo)
    expect(parsed.audio).toEqual(audio)
    expect(written(output, edits, 'flac')).toEqual(output)
    expect(written(written(output, edits, 'flac'), edits, 'flac')).toEqual(output)
  })

  it('replaces all old comment/picture blocks and preserves other blocks byte for byte', () => {
    const original = readFlac(written(flac, edits, 'flac'))
    const oldComment = original.blocks[1]!.body
    const oldPicture = original.blocks[2]!.body
    const application = Uint8Array.of(1, 7, 8, 9)
    const padding = new Uint8Array(8)
    const input = concat(encode('fLaC'), block(0, streaminfo), block(4, oldComment), block(6, oldPicture),
      block(2, application), block(4, oldComment), block(6, oldPicture), block(1, padding, true), audio)
    const next = { title: 'Replacement', artwork: { data: Uint8Array.of(4, 5), mime: 'image/png' } }
    const parsed = readFlac(written(input, next, 'flac'))
    expect(parsed.blocks.map(item => item.type)).toEqual([0, 2, 1, 4, 6])
    expect(parsed.blocks.map(item => item.last)).toEqual([false, false, false, false, true])
    expect(parsed.blocks.slice(0, 3).map(item => item.body)).toEqual([streaminfo, application, padding])
    expect(parsed.comments).toEqual({ TITLE: 'Replacement' })
    expect(parsed.artwork).toEqual({ type: 3, mime: 'image/png', data: Uint8Array.of(4, 5) })
    expect(parsed.audio).toEqual(audio)
  })

  it('preserves existing artwork when no replacement is supplied and emits an empty comment block', () => {
    const input = written(flac, edits, 'flac')
    const parsed = readFlac(written(input, {}, 'flac'))
    expect(parsed.comments).toEqual({})
    expect(parsed.artwork?.data).toEqual(cover)
    expect(parsed.blocks.at(-1)?.last).toBe(true)
    expect(parsed.audio).toEqual(audio)
  })
})

describe('invalid or unsupported inputs', () => {
  const id3 = (version: number, flags: number, length: Uint8Array): Uint8Array =>
    concat(encode('ID3'), Uint8Array.of(version, 0, flags), length, audio)
  it.each([
    new Uint8Array(), encode('RIFF0000WAVE'), concat(size(16), encode('ftypM4A ')),
    encode('ID3'), id3(2, 0, size(0)), id3(3, 16, size(0)), id3(4, 1, size(0)),
    id3(4, 0, Uint8Array.of(128, 0, 0, 0)), id3(3, 0, size(100, 4, 128)),
    concat(encode('ID3'), Uint8Array.of(4, 0, 0), size(0)),
    Uint8Array.of(255, 255, 255, 0), Uint8Array.of(255, 227, 156, 0),
    encode('fLaC'), concat(encode('fLaC'), Uint8Array.of(128, 0, 0)),
    concat(encode('fLaC'), block(0, new Uint8Array(33), true)),
    concat(encode('fLaC'), block(1, streaminfo, true)),
    concat(encode('fLaC'), block(0, streaminfo)),
    concat(encode('fLaC'), block(0, streaminfo), block(0, streaminfo, true)),
    concat(encode('fLaC'), block(0, streaminfo), block(127, new Uint8Array(), true)),
    concat(encode('fLaC'), Uint8Array.of(128, 255, 255, 255), streaminfo),
  ])('returns an error without throwing for malformed/unsupported bytes %#', input => {
    expect(() => writeTags(input, edits)).not.toThrow()
    expect(writeTags(input, edits)).toHaveProperty('error', expect.any(String))
  })

  it.each([{ year: NaN }, { year: Infinity }, { trackNo: -1 }, { trackNo: 1.5 },
    { artwork: { data: cover, mime: 'image/png\0bad' } }, { artwork: { data: cover, mime: '' } }])('rejects invalid edits %j', values => {
    expect(writeTags(audio, values)).toHaveProperty('error')
    expect(writeTags(flac, values)).toHaveProperty('error')
  })
})
