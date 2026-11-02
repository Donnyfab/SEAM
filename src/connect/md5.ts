/** MD5 of UTF-8 text, as lowercase hex (for Subsonic token authentication). */
export function md5(text: string): string {
  const input = new TextEncoder().encode(text)
  const bytes = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64)
  bytes.set(input)
  bytes[input.length] = 0x80
  const view = new DataView(bytes.buffer)
  const bitLength = input.length * 8
  view.setUint32(bytes.length - 8, bitLength >>> 0, true)
  view.setUint32(bytes.length - 4, Math.floor(bitLength / 0x100000000), true)
  const shifts = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]] as const
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
  for (let offset = 0; offset < bytes.length; offset += 64) {
    let a = a0, b = b0, c = c0, d = d0
    for (let i = 0; i < 64; i++) {
      const round = Math.floor(i / 16)
      const f = round === 0 ? (b & c) | (~b & d)
        : round === 1 ? (d & b) | (~d & c)
          : round === 2 ? b ^ c ^ d : c ^ (b | ~d)
      const word = round === 0 ? i : round === 1 ? (5 * i + 1) % 16
        : round === 2 ? (3 * i + 5) % 16 : (7 * i) % 16
      const shift = shifts[round]![i % 4]!
      const constant = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000)
      const sum = (a + f + constant + view.getUint32(offset + word * 4, true)) | 0
      const next = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0
      a = d; d = c; c = b; b = next
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0
  }
  return [a0, b0, c0, d0].map(word =>
    [0, 8, 16, 24].map(shift => ((word >>> shift) & 255).toString(16).padStart(2, '0')).join(''),
  ).join('')
}
