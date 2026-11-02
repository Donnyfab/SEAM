/** Dominant-colour extraction for artwork-reactive backgrounds. Pure: takes RGBA pixels, returns muted dark tones. */
export type RGB = [number, number, number]
export interface Palette { a: RGB; b: RGB; neutral: boolean }

export const NEUTRAL: Palette = { a: [28, 32, 40], b: [18, 20, 26], neutral: true }

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
export function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

/** Dark, desaturated version of a colour: keeps the hue, bounds lightness so white text always reads. */
export function mute(rgb: RGB, lightness: number, maxSat = 0.5): RGB {
  const [h, s] = rgbToHsl(rgb)
  return hslToRgb(h, Math.min(s, maxSat), lightness)
}

const BINS = 12
/**
 * Weighs each pixel by how colourful and mid-lit it is (greys, near-black and near-white say little about the
 * artwork's identity), groups by hue, and returns the two strongest, sufficiently different hues.
 */
export function extractPalette(px: ArrayLike<number>): Palette {
  const w = new Float64Array(BINS), sum = new Float64Array(BINS * 3)
  let total = 0, n = 0
  for (let i = 0; i + 3 < px.length; i += 4) {
    if (px[i + 3]! < 128) continue
    const rgb: RGB = [px[i]!, px[i + 1]!, px[i + 2]!]
    const [h, s, l] = rgbToHsl(rgb)
    n++
    const weight = s * s * (1 - Math.abs(2 * l - 1)) // colourful and mid-lightness count most
    if (weight < 0.02) continue
    const bin = Math.floor(h / (360 / BINS)) % BINS
    w[bin]! += weight; total += weight
    sum[bin * 3]! += rgb[0] * weight; sum[bin * 3 + 1]! += rgb[1] * weight; sum[bin * 3 + 2]! += rgb[2] * weight
  }
  if (!n || total / n < 0.02) { // essentially greyscale artwork → keep the glass neutral, only slightly tinted by lightness
    return NEUTRAL
  }
  const order = [...w.keys()].sort((x, y) => w[y]! - w[x]!)
  const at = (b: number): RGB => [sum[b * 3]! / w[b]!, sum[b * 3 + 1]! / w[b]!, sum[b * 3 + 2]! / w[b]!]
  const first = order[0]!
  const second = order.find(b => w[b]! > total * 0.12 && Math.min(Math.abs(b - first), BINS - Math.abs(b - first)) >= 2)
  const pa = at(first)
  const pb = second !== undefined ? at(second) : pa
  return {
    a: mute(pa, 0.32, 0.58),
    b: second !== undefined ? mute(pb, 0.24, 0.55) : mute(pa, 0.18, 0.45),
    neutral: false,
  }
}

export const rgbCss = (c: RGB) => `rgb(${c[0]} ${c[1]} ${c[2]})`
