import { clamp, fadeGains, type FadeCurve } from '../core/crossfade'

export interface EnvelopeSpec {
  /** playable duration in seconds */
  duration: number
  overlapIn: number
  curveIn: FadeCurve
  overlapOut: number
  curveOut: FadeCurve
  fadeIn: number
  fadeOut: number
}

export const ENVELOPE_RATE = 100 // samples per second

/** Gain at clip time t (0..duration): product of crossfade curves and edge fades. */
export function gainAt(s: EnvelopeSpec, t: number): number {
  let g = 1
  if (s.overlapIn > 0 && t < s.overlapIn) g *= fadeGains(s.curveIn, t / s.overlapIn).in
  if (s.fadeIn > 0 && t < s.fadeIn) g *= t / s.fadeIn
  const tail = s.duration - t
  if (s.overlapOut > 0 && tail < s.overlapOut) g *= fadeGains(s.curveOut, 1 - tail / s.overlapOut).out
  if (s.fadeOut > 0 && tail < s.fadeOut) g *= tail / s.fadeOut
  return clamp(g, 0, 1)
}

export const needsEnvelope = (s: EnvelopeSpec) => s.overlapIn > 0 || s.overlapOut > 0 || s.fadeIn > 0 || s.fadeOut > 0

/** Sampled envelope from clip time `from` to the end (>= 2 points), for setValueCurveAtTime. */
export function buildEnvelope(s: EnvelopeSpec, from = 0, rate = ENVELOPE_RATE): Float32Array {
  const span = Math.max(s.duration - from, 0)
  const n = Math.max(2, Math.ceil(span * rate) + 1)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = gainAt(s, Math.min(from + (i / (n - 1)) * span, s.duration))
  return out
}
