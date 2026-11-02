import { describe, expect, it } from 'vitest'
import { EQ_BANDS, EQ_PRESETS, defaultFx, distortionCurve, normalizeFx, reverbImpulse } from '../src/audio/presets'

describe('fx presets', () => {
  it('every preset has one gain per band', () => { for (const g of Object.values(EQ_PRESETS)) expect(g).toHaveLength(EQ_BANDS.length) })
  it('normalize clamps and fills', () => {
    const f = normalizeFx({ eq: [99, -99], reverb: 5, delayFeedback: 2, preamp: -50 })
    expect(f.eq).toHaveLength(10); expect(f.eq[0]).toBe(12); expect(f.eq[1]).toBe(-12); expect(f.eq[9]).toBe(0)
    expect([f.reverb, f.delayFeedback, f.preamp]).toEqual([1, 0.9, -12])
    expect(normalizeFx(undefined)).toEqual(defaultFx)
  })
  it('distortion curve is odd-symmetric, bounded and monotonic', () => {
    const c = distortionCurve(0.5, 101)
    expect(c[0]).toBeCloseTo(-1, 6); expect(c[100]).toBeCloseTo(1, 6); expect(c[50]).toBeCloseTo(0, 6)
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]!)
  })
  it('reverb impulse decays and is deterministic', () => {
    const [a] = reverbImpulse(8000, 1, 3, 7), [b] = reverbImpulse(8000, 1, 3, 7)
    expect(Array.from(a!.slice(0, 5))).toEqual(Array.from(b!.slice(0, 5)))
    const e = (x: Float32Array) => x.reduce((s, v) => s + v * v, 0)
    expect(e(a!.slice(0, 4000))).toBeGreaterThan(e(a!.slice(4000)))
  })
})
