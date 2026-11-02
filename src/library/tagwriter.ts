export interface TagEdits {
  title?: string
  artist?: string
  albumArtist?: string
  album?: string
  genre?: string
  composer?: string
  year?: number
  trackNo?: number
  comment?: string
  lyrics?: string
  artwork?: { data: Uint8Array; mime: string }
}

type WriteResult = { bytes: Uint8Array; format: 'mp3' | 'flac' } | { error: string }

function join(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}

function utf8(value: string): Uint8Array { return new TextEncoder().encode(value) }

function integer(value: number, length: number, little = false): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** (8 * length)) {
    throw new Error('Metadata is too large')
  }
  const result = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    result[little ? i : length - i - 1] = value % 256
    value = Math.floor(value / 256)
  }
  return result
}

function synchsafe(value: number): Uint8Array {
  if (value >= 2 ** 28) throw new Error('ID3 metadata is too large')
  return Uint8Array.of((value >>> 21) & 127, (value >>> 14) & 127, (value >>> 7) & 127, value & 127)
}

function isAt(file: Uint8Array, offset: number, text: string): boolean {
  return [...text].every((char, i) => file[offset + i] === char.charCodeAt(0))
}

const fields = [
  ['title', 'TIT2', 'TITLE'], ['artist', 'TPE1', 'ARTIST'],
  ['albumArtist', 'TPE2', 'ALBUMARTIST'], ['album', 'TALB', 'ALBUM'],
  ['genre', 'TCON', 'GENRE'], ['composer', 'TCOM', 'COMPOSER'],
  ['year', 'TDRC', 'DATE'], ['trackNo', 'TRCK', 'TRACKNUMBER'],
  ['comment', 'COMM', 'COMMENT'], ['lyrics', 'USLT', 'LYRICS'],
] as const

function writeMp3(file: Uint8Array, edits: TagEdits): Uint8Array {
  let start = 0
  if (isAt(file, 0, 'ID3')) {
    if (file.length < 10) throw new Error('Truncated ID3 header')
    const version = file[3]!
    const flags = file[5]!
    if ((version !== 3 && version !== 4) || file[4] === 255 ||
        (flags & (version === 3 ? 31 : 15)) !== 0) throw new Error('Invalid ID3 header')
    const sizeBytes = file.subarray(6, 10)
    if (sizeBytes.some(byte => byte > 127)) throw new Error('Invalid ID3 synchsafe size')
    const size = sizeBytes.reduce((sum, byte) => sum * 128 + byte, 0)
    start = 10 + size
    if (version === 4 && (flags & 16) !== 0) {
      if (!isAt(file, start, '3DI') || file[start + 3] !== version ||
          file[start + 4] !== file[4] || file[start + 5] !== flags ||
          !sizeBytes.every((byte, i) => file[start + 6 + i] === byte)) {
        throw new Error('Invalid ID3 footer')
      }
      start += 10
    }
    if (start > file.length) throw new Error('Truncated ID3 tag')
  }
  const end = file.length >= 128 && isAt(file, file.length - 128, 'TAG') ? file.length - 128 : file.length
  // Check the MPEG frame header without trying to decode the audio payload.
  const second = file[start + 1] ?? 0
  const third = file[start + 2] ?? 255
  if (start + 4 > end || file[start] !== 255 || (second & 224) !== 224 ||
      (second & 24) === 8 || (second & 6) === 0 || (third & 240) === 240 ||
      (third & 12) === 12) throw new Error('Invalid MP3 audio header')
  const frames: Uint8Array[] = []
  const frame = (id: string, body: Uint8Array): void => {
    frames.push(join(utf8(id), synchsafe(body.length), Uint8Array.of(0, 0), body))
  }
  for (const [key, id] of fields) {
    const value = edits[key]
    if (value === undefined) continue
    const prefix = id === 'COMM' || id === 'USLT' ? Uint8Array.of(3, 101, 110, 103, 0) : Uint8Array.of(3)
    frame(id, join(prefix, utf8(String(value))))
  }
  if (edits.artwork) {
    frame('APIC', join(Uint8Array.of(3), utf8(edits.artwork.mime), Uint8Array.of(0, 3, 0), edits.artwork.data))
  }
  const body = join(...frames)
  return join(utf8('ID3'), Uint8Array.of(4, 0, 0), synchsafe(body.length), body, file.subarray(start))
}

function writeFlac(file: Uint8Array, edits: TagEdits): Uint8Array {
  const blocks: { type: number; body: Uint8Array }[] = []
  let offset = 4
  let last = false
  while (!last) {
    if (offset + 4 > file.length) throw new Error('Truncated FLAC metadata header')
    const type = file[offset]! & 127
    last = (file[offset]! & 128) !== 0
    const length = file[offset + 1]! * 65536 + file[offset + 2]! * 256 + file[offset + 3]!
    offset += 4
    if (type === 127 || offset + length > file.length ||
        (blocks.length === 0 ? type !== 0 || length !== 34 : type === 0)) {
      throw new Error('Invalid FLAC metadata block')
    }
    blocks.push({ type, body: file.subarray(offset, offset + length) })
    offset += length
  }
  const kept = blocks.filter(block => block.type !== 4 && !(edits.artwork && block.type === 6))
  const vendor = utf8('SEAM')
  const comments: Uint8Array[] = []
  for (const [key, , name] of fields) {
    if (edits[key] === undefined) continue
    const value = utf8(`${name}=${edits[key]}`)
    comments.push(join(integer(value.length, 4, true), value))
  }
  kept.push({ type: 4, body: join(integer(vendor.length, 4, true), vendor, integer(comments.length, 4, true), ...comments) })
  if (edits.artwork) {
    const mime = utf8(edits.artwork.mime)
    // Front cover, empty description, unknown dimensions/depth/palette size.
    kept.push({ type: 6, body: join(integer(3, 4), integer(mime.length, 4), mime,
      new Uint8Array(20), integer(edits.artwork.data.length, 4), edits.artwork.data) })
  }
  return join(utf8('fLaC'), ...kept.map((block, i) => join(
    Uint8Array.of(block.type | (i === kept.length - 1 ? 128 : 0)), integer(block.body.length, 3), block.body,
  )), file.subarray(offset))
}

/** Replace supported tags with the supplied fields; omitted text fields are removed.
 * FLAC blocks other than comments (and pictures when replacing artwork) are retained.
 * Input buffers are never modified. Malformed/unsupported input returns an error.
 */
export function writeTags(file: Uint8Array, edits: TagEdits): WriteResult {
  try {
    for (const key of ['year', 'trackNo'] as const) {
      const value = edits[key]
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`Invalid ${key}`)
    }
    if (edits.artwork && (!edits.artwork.mime || /[^\x20-\x7e]/.test(edits.artwork.mime))) {
      throw new Error('Invalid artwork MIME type')
    }
    if (isAt(file, 0, 'fLaC')) return { bytes: writeFlac(file, edits), format: 'flac' }
    if (isAt(file, 0, 'ID3') || (file[0] === 255 && ((file[1] ?? 0) & 224) === 224)) {
      return { bytes: writeMp3(file, edits), format: 'mp3' }
    }
    return { error: 'Unsupported audio format (expected MP3 or FLAC)' }
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : 'Could not write tags' }
  }
}
