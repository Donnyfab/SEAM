import { describe, expect, it } from 'vitest'
import { buildEnvelope, gainAt, needsEnvelope, type EnvelopeSpec } from '../src/audio/envelope'

const base: EnvelopeSpec = { duration: 10, overlapIn: 0, curveIn: 'equalPower', overlapOut: 0, curveOut: 'equalPower', fadeIn: 0, fadeOut: 0 }

describe('envelope', () => {
  it('flat when no fades', () => { expect(needsEnvelope(base)).toBe(false); expect(gainAt(base, 5)).toBe(1) })
  it('crossfade in/out are power-complementary against the partner', () => {
    const out: EnvelopeSpec = { ...base, overlapOut: 4 }
    const inn: EnvelopeSpec = { ...base, overlapIn: 4 }
    for (let t = 0; t <= 4; t += 0.5) {
      const a = gainAt(out, 6 + t), b = gainAt(inn, t)
      expect(a * a + b * b).toBeCloseTo(1, 9)
    }
  })
  it('edge fades reach zero at the boundary', () => {
    const s = { ...base, fadeIn: 2, fadeOut: 2 }
    expect(gainAt(s, 0)).toBe(0); expect(gainAt(s, 10)).toBe(0); expect(gainAt(s, 5)).toBe(1)
  })
  it('builds a curve starting mid-clip', () => {
    const e = buildEnvelope({ ...base, overlapOut: 4 }, 7)
    expect(e.length).toBeGreaterThanOrEqual(2); expect(e[0]).toBeCloseTo(gainAt({ ...base, overlapOut: 4 }, 7), 6); expect(e.at(-1)).toBeCloseTo(0, 6)
  })
})
