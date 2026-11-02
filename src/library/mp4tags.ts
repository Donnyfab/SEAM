import type { TagEdits } from './tagwriter'

interface Atom {
  type: string
  wide: boolean
  body: Uint8Array
  children?: Atom[]
}

const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta', 'meta', 'ilst'])
const fields = [
  ['title', '\xa9nam'], ['artist', '\xa9ART'], ['albumArtist', 'aART'],
  ['album', '\xa9alb'], ['genre', '\xa9gen'], ['composer', '\xa9wrt'],
  ['year', '\xa9day'], ['comment', '\xa9cmt'], ['lyrics', '\xa9lyr'],
] as const

function join(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}

function numberBytes(value: bigint, width: number): Uint8Array {
  if (value < 0n || value >= 1n << BigInt(width * 8)) throw new Error('MP4 integer overflow')
  const bytes = new Uint8Array(width)
  for (let i = width - 1; i >= 0; i--) { bytes[i] = Number(value & 255n); value >>= 8n }
  return bytes
}

function readNumber(bytes: Uint8Array, offset: number, width: number): bigint {
  if (offset + width > bytes.length) throw new Error('Truncated MP4 integer')
  let value = 0n
  for (let i = 0; i < width; i++) value = value * 256n + BigInt(bytes[offset + i]!)
  return value
}

function parse(bytes: Uint8Array, depth = 0, parent = ''): Atom[] {
  if (depth > 100) throw new Error('MP4 atom nesting is too deep')
  const atoms: Atom[] = []
  let offset = 0
  while (offset < bytes.length) {
    if (bytes.length - offset < 8) throw new Error('Truncated MP4 atom header')
    const size32 = Number(readNumber(bytes, offset, 4))
    const wide = size32 === 1
    const header = wide ? 16 : 8
    const size = size32 === 0 ? BigInt(bytes.length - offset) : wide ? readNumber(bytes, offset + 8, 8) : BigInt(size32)
    if (size < BigInt(header) || size > BigInt(bytes.length - offset)) throw new Error('Invalid MP4 atom size')
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const body = bytes.subarray(offset + header, offset + Number(size))
    const atom: Atom = { type, wide, body }
    if (containers.has(type) || parent === 'ilst') {
      const prefix = type === 'meta' ? 4 : 0
      if (body.length < prefix) throw new Error('Truncated MP4 meta flags')
      atom.children = parse(body.subarray(prefix), depth + 1, type)
    }
    atoms.push(atom)
    offset += Number(size)
  }
  return atoms
}

function encode(atom: Atom): Uint8Array {
  const body = atom.children ? join([
    ...(atom.type === 'meta' ? [atom.body.subarray(0, 4)] : []),
    ...atom.children.map(encode),
  ]) : atom.body
  const wide = atom.wide || body.length + 8 > 0xffffffff
  return join([
    numberBytes(BigInt(wide ? 1 : body.length + 8), 4),
    Uint8Array.from(atom.type, c => c.charCodeAt(0)),
    ...(wide ? [numberBytes(BigInt(body.length + 16), 8)] : []), body,
  ])
}

function leaf(type: string, body: Uint8Array): Atom { return { type, wide: false, body } }
function container(type: string, children: Atom[]): Atom {
  return { type, wide: false, body: type === 'meta' ? new Uint8Array(4) : new Uint8Array(), children }
}
function tag(type: string, data: Uint8Array, kind = 1): Atom {
  return container(type, [leaf('data', join([numberBytes(BigInt(kind), 4), new Uint8Array(4), data]))])
}

function offsetTables(atom: Atom, delta: bigint): void {
  if (atom.type === 'stco' || atom.type === 'co64') {
    const width = atom.type === 'stco' ? 4 : 8
    const count = readNumber(atom.body, 4, 4)
    if (8n + count * BigInt(width) !== BigInt(atom.body.length)) throw new Error('Invalid MP4 chunk offset table')
    const body = atom.body.slice()
    for (let i = 8; i < body.length; i += width) {
      body.set(numberBytes(readNumber(body, i, width) + delta, width), i)
    }
    atom.body = body
  }
  for (const child of atom.children ?? []) offsetTables(child, delta)
}

/** Replace supported text tags, retaining unrelated atoms and artwork unless supplied.
 * Chunk offsets are adjusted when growing/shrinking a movie before its audio data.
 * The input is never mutated; malformed trees and unrepresentable offsets return errors.
 */
export function writeMp4Tags(file: Uint8Array, edits: TagEdits): { bytes: Uint8Array; format: 'm4a' } | { error: string } {
  try {
    const atoms = parse(file)
    if (atoms[0]?.type !== 'ftyp' || atoms[0].body.length < 8) throw new Error('Invalid MP4 ftyp')
    const movies = atoms.filter(atom => atom.type === 'moov')
    const moov = movies[0]
    const mdatIndex = atoms.findIndex(atom => atom.type === 'mdat')
    if (movies.length !== 1 || !moov || mdatIndex < 0) throw new Error('Missing or ambiguous MP4 movie/audio atoms')
    offsetTables(moov, 0n)
    const oldSize = encode(moov).length
    const ensure = (parent: Atom, type: string): Atom => {
      const found = parent.children?.find(atom => atom.type === type)
      if (found) return found
      const child = container(type, [])
      parent.children!.push(child)
      return child
    }
    const udta = ensure(moov, 'udta')
    const meta = ensure(udta, 'meta')
    if (!meta.children!.some(atom => atom.type === 'hdlr')) {
      meta.children!.push(leaf('hdlr', join([new Uint8Array(8), Uint8Array.of(109, 100, 105, 114), new Uint8Array(13)])))
    }
    const ilst = ensure(meta, 'ilst')
    const replaced = new Set<string>([...fields.map(([, type]) => type), 'trkn', ...(edits.artwork ? ['covr'] : [])])
    ilst.children = ilst.children!.filter(atom => !replaced.has(atom.type))
    for (const [key, type] of fields) {
      const value = edits[key]
      if (value === undefined) continue
      if (key === 'year' && (!Number.isSafeInteger(value) || Number(value) < 0)) throw new Error('Invalid year')
      ilst.children.push(tag(type, new TextEncoder().encode(String(value))))
    }
    if (edits.trackNo !== undefined) {
      if (!Number.isSafeInteger(edits.trackNo) || edits.trackNo < 0 || edits.trackNo > 65535) throw new Error('Invalid trackNo')
      ilst.children.push(tag('trkn', join([new Uint8Array(2), numberBytes(BigInt(edits.trackNo), 2), new Uint8Array(4)]), 0))
    }
    if (edits.artwork) {
      const kind = edits.artwork.mime === 'image/jpeg' ? 13 : edits.artwork.mime === 'image/png' ? 14 : 0
      if (!kind) throw new Error('MP4 artwork must be JPEG or PNG')
      ilst.children.push(tag('covr', edits.artwork.data, kind))
    }
    const delta = encode(moov).length - oldSize
    if (atoms.indexOf(moov) < mdatIndex) offsetTables(moov, BigInt(delta))
    return { bytes: join(atoms.map(encode)), format: 'm4a' }
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : 'Could not write MP4 tags' }
  }
}
