import { afterEach, describe, expect, it, vi } from 'vitest'
import { challengeFor, generateVerifier, randomState } from '../src/connect/pkce'

afterEach(() => vi.restoreAllMocks())

describe('PKCE', () => {
  it('matches RFC 7636 Appendix B', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('uses 48 cryptographic random bytes for a 64-character base64url verifier', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const verifier = generateVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{64}$/)
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0]![0]).toBeInstanceOf(Uint8Array)
    expect(spy.mock.calls[0]![0]?.byteLength).toBe(48)
    expect(generateVerifier()).not.toBe(verifier)
  })

  it('creates independent unpredictable URL-safe states', () => {
    const state = randomState()
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(randomState()).not.toBe(state)
  })

  it('hashes deterministically without padding', async () => {
    const verifier = generateVerifier()
    expect(await challengeFor(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await challengeFor(verifier)).toBe(await challengeFor(verifier))
  })
})
