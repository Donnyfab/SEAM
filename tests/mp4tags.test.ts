import { describe, expect, it } from 'vitest'
import { writeMp4Tags } from '../src/library/mp4tags'
import { writeTags, type TagEdits } from '../src/library/tagwriter'

const text = (s: string): Uint8Array => new TextEncoder().encode(s)
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
const u32 = (n: number): Uint8Array => {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, n)
  return out
}
const u64 = (n: bigint): Uint8Array => {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, n)
  return out
}
const box = (type: string, body: Uint8Array, wide = false): Uint8Array => concat(
  u32(wide ? 1 : body.length + 8), Uint8Array.from(type, c => c.charCodeAt(0)),
  ...(wide ? [u64(BigInt(body.length + 16))] : []), body,
)
const item = (type: string, body: Uint8Array, kind = 1): Uint8Array => box(type, box('data', concat(u32(kind), u32(0), body)))
const audio = Uint8Array.of(11, 22, 33, 44, 55, 66, 77, 88)

// Independent reader: uses absolute DataView offsets and explicitly walks only
// the paths asserted below, without importing writer parsing/encoding helpers.
interface ReadBox { type: string; start: number; body: number; end: number }
function boxes(bytes: Uint8Array, from = 0, to = bytes.length): ReadBox[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: ReadBox[] = []
  for (let at = from; at < to;) {
    const short = view.getUint32(at)
    const length = short === 1 ? Number(view.getBigUint64(at + 8)) : short || to - at
    const type = String.fromCharCode(...bytes.slice(at + 4, at + 8))
    out.push({ type, start: at, body: at + (short === 1 ? 16 : 8), end: at + length })
    at += length
  }
  return out
}
function read(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const roots = boxes(bytes)
  const movie = roots.find(b => b.type === 'moov')!
  const kids = (b: ReadBox): ReadBox[] => boxes(bytes, b.body + (b.type === 'meta' ? 4 : 0), b.end)
  const child = (b: ReadBox, type: string): ReadBox => kids(b).find(c => c.type === type)!
  const meta = child(child(movie, 'udta'), 'meta')
  const tags = new Map(kids(child(meta, 'ilst')).map(b => {
    const data = child(b, 'data')
    return [b.type, { kind: view.getUint32(data.body), data: bytes.slice(data.body + 8, data.end) }]
  }))
  const offsets: bigint[] = []
  for (const track of kids(movie).filter(b => b.type === 'trak')) {
    const table = child(child(child(track, 'mdia'), 'minf'), 'stbl')
    for (const b of kids(table).filter(b => b.type === 'stco' || b.type === 'co64')) {
      const count = view.getUint32(b.body + 4)
      for (let i = 0; i < count; i++) offsets.push(b.type === 'co64'
        ? view.getBigUint64(b.body + 8 + i * 8) : BigInt(view.getUint32(b.body + 8 + i * 4)))
    }
  }
  return { tags, offsets, roots, movie, meta }
}

function fixture(first: boolean, wide = false, metadata = false, zeroMdat = false): Uint8Array {
  const ftyp = box('ftyp', concat(text('M4A '), u32(0), text('isom')))
  const track = (offsets: number[], co64: boolean): Uint8Array => box('trak', box('mdia', box('minf', box('stbl',
    box(co64 ? 'co64' : 'stco', concat(u32(0), u32(offsets.length), ...offsets.map(n => co64 ? u64(BigInt(n)) : u32(n)))), wide))))
  const oldTags = metadata ? box('udta', concat(box('free', text('keep udta')), box('meta', concat(
    Uint8Array.of(0, 0, 0, 7), box('free', text('keep meta')),
    box('ilst', concat(item('\xa9nam', text('Old title'.repeat(100))), item('\xa9ART', text('Old artist')),
      item('cust', text('keep custom')), item('covr', Uint8Array.of(9, 8), 13))),
  )))) : new Uint8Array()
  const movie = (start: number): Uint8Array => box('moov', concat(
    box('free', text('keep movie')), track([start, start + 2], false), track([start + 4], true), oldTags,
  ), wide)
  const mdat = zeroMdat ? concat(u32(0), text('mdat'), audio) : box('mdat', audio, wide)
  const start = ftyp.length + (first ? movie(0).length : 0) + (wide && !zeroMdat ? 16 : 8)
  return concat(ftyp, ...(first ? [movie(start), mdat] : [mdat, movie(start)]))
}

const edits: TagEdits = {
  title: '夜 — Title', artist: 'Artist', albumArtist: 'Album artist', album: 'Album',
  genre: 'Jazz', composer: 'Composer', year: 2026, trackNo: 513,
  comment: 'Comment', lyrics: 'Line 1\nLine 2', artwork: { mime: 'image/png', data: Uint8Array.of(137, 80, 78, 71) },
}
function written(input: Uint8Array, values: TagEdits = edits): Uint8Array {
  const result = writeMp4Tags(input, values)
  if ('error' in result) throw new Error(result.error)
  expect(result.format).toBe('m4a')
  return result.bytes
}

function expectAudio(bytes: Uint8Array): void {
  const result = read(bytes)
  const mdat = result.roots.find(b => b.type === 'mdat')!
  expect(bytes.slice(mdat.body, mdat.end)).toEqual(audio)
  expect(result.offsets.map(n => bytes[Number(n)])).toEqual([11, 33, 55])
  expect(result.offsets).toEqual([0, 2, 4].map(n => BigInt(mdat.body + n)))
}

describe('MP4 tag writing', () => {
  for (const first of [true, false]) for (const wide of [false, true]) for (const metadata of [false, true]) {
    it(`round-trips ${first ? 'moov-first' : 'moov-last'}, ${wide ? '64' : '32'}-bit atoms, metadata=${metadata}`, () => {
      const input = fixture(first, wide, metadata)
      const original = input.slice()
      const output = written(input)
      expect(input).toEqual(original)
      expectAudio(output)
      const result = read(output)
      const expected = new Map([
        ['\xa9nam', edits.title], ['\xa9ART', edits.artist], ['aART', edits.albumArtist],
        ['\xa9alb', edits.album], ['\xa9gen', edits.genre], ['\xa9wrt', edits.composer],
        ['\xa9day', '2026'], ['\xa9cmt', edits.comment], ['\xa9lyr', edits.lyrics],
      ])
      for (const [key, value] of expected) {
        expect(result.tags.get(key)?.kind).toBe(1)
        expect(new TextDecoder().decode(result.tags.get(key)?.data)).toBe(value)
      }
      expect(result.tags.get('trkn')).toEqual({ kind: 0, data: Uint8Array.of(0, 0, 2, 1, 0, 0, 0, 0) })
      expect(result.tags.get('covr')).toEqual({ kind: 14, data: edits.artwork!.data })
      expect(output.slice(result.movie.body, result.movie.body + 18)).toEqual(box('free', text('keep movie')))
      if (metadata) {
        expect(new TextDecoder().decode(result.tags.get('cust')?.data)).toBe('keep custom')
        expect(output.slice(result.meta.body, result.meta.body + 4)).toEqual(Uint8Array.of(0, 0, 0, 7))
        for (const value of ['keep udta', 'keep meta']) expect(new TextDecoder().decode(output)).toContain(value)
      }
      const again = written(output)
      expect(again).toEqual(output)
      const changed = written(again, { title: 'Short', artwork: { mime: 'image/jpeg', data: Uint8Array.of(255, 216, 255) } })
      expectAudio(changed)
      expect(read(changed).tags.get('covr')?.kind).toBe(13)
      expect(read(changed).tags.has('\xa9ART')).toBe(false)
      const oldOffsets = read(written(input, {})).offsets
      if (!first) expect(result.offsets).toEqual(oldOffsets)
    })
  }

  it('retains cover art when artwork is omitted, and handles an mdat extending to EOF', () => {
    const output = written(fixture(true, true, true, true), { title: 'New' })
    expectAudio(output)
    expect(read(output).tags.get('covr')).toEqual({ kind: 13, data: Uint8Array.of(9, 8) })
  })

  it('dispatches M4A, MP4 and audiobook brands through writeTags', () => {
    for (const brand of ['M4A ', 'isom', 'M4B ']) {
      const input = fixture(true)
      input.set(text(brand), 8)
      const result = writeTags(input, edits)
      expect('format' in result && result.format).toBe('m4a')
      if ('bytes' in result) expectAudio(result.bytes)
    }
  })

  it('rejects corrupt atom trees without throwing or changing input', () => {
    const good = fixture(true, true, true)
    const cases = [new Uint8Array(), good.slice(0, 7), good.slice(0, -1), concat(good, Uint8Array.of(1)),
      concat(box('ftyp', new Uint8Array(8)), box('moov', box('udta', box('meta', new Uint8Array(3)))), box('mdat', audio)),
      concat(box('ftyp', new Uint8Array(8)), box('moov', box('trak', box('stco', concat(u32(0), u32(2), u32(0))))), box('mdat', audio)),
      concat(box('ftyp', new Uint8Array(8)), box('mdat', audio)),
      concat(box('ftyp', new Uint8Array(8)), box('moov', new Uint8Array()), box('moov', new Uint8Array()), box('mdat', audio)),
    ]
    const tooSmall = good.slice(); tooSmall.set(u32(4), 0); cases.push(tooSmall)
    const huge = good.slice(); huge.set(u64(0xffffffffffffffffn), 28); cases.push(huge)
    const badOffsets = fixture(true)
    const tableAt = new TextDecoder().decode(badOffsets).indexOf('stco') - 4
    badOffsets.set(u32(0xffffffff), tableAt + 16); cases.push(badOffsets)
    for (const input of cases) {
      const before = input.slice()
      expect(writeMp4Tags(input, edits)).toHaveProperty('error')
      expect(input).toEqual(before)
    }
  })

  it('rejects invalid track/year values and unsupported artwork', () => {
    for (const values of [{ trackNo: 65536 }, { trackNo: -1 }, { trackNo: 1.5 }, { year: NaN },
      { artwork: { data: new Uint8Array(), mime: 'image/gif' } }]) {
      expect(writeMp4Tags(fixture(true), values)).toHaveProperty('error')
    }
  })
})
