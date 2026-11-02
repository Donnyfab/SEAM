import { pbkdf2Sync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createPasscodeRecord, nextLockout, verifyPasscode } from '../src/security/passcode'

describe('passcode records', () => {
  it('derives PBKDF2 SHA-256 with a random 16-byte salt and 32-byte hash', async () => {
    const record = await createPasscodeRecord('1234', 100)
    expect(record.version).toBe(1)
    expect(record.iterations).toBe(100)
    expect(Buffer.from(record.salt, 'base64')).toHaveLength(16)
    expect(Buffer.from(record.hash, 'base64')).toHaveLength(32)
    expect(record.hash).toBe(pbkdf2Sync('1234', Buffer.from(record.salt, 'base64'), 100, 32, 'sha256').toString('base64'))
    const other = await createPasscodeRecord('1234', 100)
    expect(other.salt).not.toBe(record.salt)
    expect(other.hash).not.toBe(record.hash)
  })
  it.each(['1234', 'é🔒', '', '0000'])('verifies exact UTF-8 input %j', async code => {
    const record = await createPasscodeRecord(code, 10)
    await expect(verifyPasscode(code, record)).resolves.toBe(true)
    await expect(verifyPasscode(`${code} `, record)).resolves.toBe(false)
  })
  it('rejects corrupted records and hash mismatches at either end', async () => {
    const record = await createPasscodeRecord('1234', 10)
    for (const patch of [{ salt: '!' }, { hash: 'AA==' }, { iterations: 0 }, { version: 2 }, { salt: '' }]) {
      await expect(verifyPasscode('1234', { ...record, ...patch } as typeof record)).resolves.toBe(false)
    }
    for (const index of [0, 31]) {
      const hash = Buffer.from(record.hash, 'base64')
      hash[index] = hash[index]! ^ 1
      await expect(verifyPasscode('1234', { ...record, hash: hash.toString('base64') })).resolves.toBe(false)
    }
  })
  it.each([0, -1, 1.5, NaN, Infinity, 2 ** 32])('rejects invalid iteration count %s', async iterations => {
    await expect(createPasscodeRecord('1234', iterations)).rejects.toThrow(RangeError)
  })
})

describe('lockout policy', () => {
  it('allows four failures then escalates and caps at 900 seconds', () => {
    expect(Array.from({ length: 11 }, (_, count) => nextLockout(count))).toEqual([0, 0, 0, 0, 0, 30, 60, 300, 900, 900, 900])
    expect(nextLockout(100000)).toBe(900)
    expect(nextLockout(-1)).toBe(0)
  })
})
