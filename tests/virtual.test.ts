import { describe, expect, it } from 'vitest'
import { computeWindow } from '../src/ui/virtual'

describe('computeWindow', () => {
  it('renders only a viewport-sized slice plus overscan', () => {
    const w = computeWindow(0, 800, 100, 64, 3000, 8)
    expect(w.first).toBe(0); expect(w.last).toBeLessThan(40)
    expect(w.padTop).toBe(0); expect(w.padBottom).toBe((3000 - w.last) * 64)
  })
  it('moves with scroll and keeps total height constant', () => {
    const a = computeWindow(6400, 800, 100, 64, 3000, 8), total = (w: typeof a) => w.padTop + (w.last - w.first) * 64 + w.padBottom
    expect(a.first).toBeGreaterThan(80); expect(total(a)).toBe(3000 * 64)
  })
  it('clamps at the end and for empty lists', () => {
    const end = computeWindow(1e9, 800, 0, 64, 100, 8); expect(end.last).toBe(100); expect(end.padBottom).toBe(0)
    expect(computeWindow(0, 800, 0, 64, 0)).toEqual({ first: 0, last: 0, padTop: 0, padBottom: 0 })
  })
  it('handles lists above the viewport top (list offset > scroll)', () => {
    const w = computeWindow(0, 800, 500, 64, 1000, 4); expect(w.first).toBe(0); expect(w.last).toBeLessThan(12)
  })
})
