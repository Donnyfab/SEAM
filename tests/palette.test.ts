import { describe, expect, it } from 'vitest'
import { extractPalette, NEUTRAL, rgbCss, type RGB } from '../src/core/palette'

const fill = (rgb: RGB, n = 400) => { const a = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) a.set([...rgb, 255], i * 4); return a }
const lightness = (c: RGB) => (Math.max(...c) + Math.min(...c)) / 510
const hue = (c: RGB) => { const [r, g, b] = c; const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b); if (!d) return -1; return (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 }

describe('extractPalette', () => {
  it('keeps the hue of blue artwork but makes it dark and muted', () => {
    const p = extractPalette(fill([30, 90, 220]))
    expect(p.neutral).toBe(false)
    expect(hue(p.a)).toBeGreaterThan(200); expect(hue(p.a)).toBeLessThan(250)
    expect(lightness(p.a)).toBeLessThan(0.36)
  })
  it('keeps the hue of red artwork', () => {
    const p = extractPalette(fill([220, 40, 40]))
    const h = hue(p.a); expect(h < 15 || h > 345).toBe(true)
  })
  it('falls back to neutral glass for greyscale, black or transparent artwork', () => {
    expect(extractPalette(fill([120, 120, 120]))).toBe(NEUTRAL)
    expect(extractPalette(fill([0, 0, 0]))).toBe(NEUTRAL)
    expect(extractPalette(new Uint8ClampedArray(400))).toBe(NEUTRAL)
    expect(extractPalette(new Uint8ClampedArray(0))).toBe(NEUTRAL)
  })
  it('picks a second, different hue when the artwork has two colours', () => {
    const a = new Uint8ClampedArray(800 * 4); a.set(fill([30, 90, 220], 400)); a.set(fill([230, 120, 20], 400), 400 * 4)
    const p = extractPalette(a); expect(Math.abs(hue(p.a) - hue(p.b))).toBeGreaterThan(60)
  })
  it('never exceeds a lightness that would hurt white text, even for neon colours', () => {
    const p = extractPalette(fill([255, 255, 0])); expect(lightness(p.a)).toBeLessThan(0.36); expect(lightness(p.b)).toBeLessThan(0.36)
  })
  it('formats css colours', () => { expect(rgbCss([1, 2, 3])).toBe('rgb(1 2 3)') })
})
