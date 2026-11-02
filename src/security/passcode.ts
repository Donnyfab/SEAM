export interface PasscodeRecord {
  salt: string
  hash: string
  iterations: number
  version: 1
}

function validIterations(iterations: number): boolean {
  return Number.isSafeInteger(iterations) && iterations > 0 && iterations <= 0xffffffff
}

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0))
  if (encode(bytes) !== value) throw new Error('Invalid base64')
  return bytes
}

async function derive(code: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits'],
  )
  return new Uint8Array(await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256,
  ))
}

export async function createPasscodeRecord(code: string, iterations = 210000): Promise<PasscodeRecord> {
  if (!validIterations(iterations)) throw new RangeError('Iterations must be a positive 32-bit integer')
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(code, salt, iterations)
  return { salt: encode(salt), hash: encode(hash), iterations, version: 1 }
}

export async function verifyPasscode(code: string, record: PasscodeRecord): Promise<boolean> {
  if (record.version !== 1 || !validIterations(record.iterations)) return false
  let salt: Uint8Array<ArrayBuffer>
  let expected: Uint8Array
  try {
    salt = decode(record.salt)
    expected = decode(record.hash)
  } catch {
    return false
  }
  if (salt.length !== 16 || expected.length !== 32) return false
  const actual = await derive(code, salt, record.iterations)
  // Fixed-length XOR comparison: no early return based on matching secret bytes.
  let difference = 0
  for (let i = 0; i < 32; i++) difference |= actual[i]! ^ expected[i]!
  return difference === 0
}

/** Delay after the given total number of failed attempts (starting at one). */
export function nextLockout(failedAttempts: number): number {
  if (Number.isNaN(failedAttempts) || failedAttempts < 5) return 0
  return [30, 60, 300, 900][Math.min(3, Math.floor(failedAttempts) - 5)]!
}
