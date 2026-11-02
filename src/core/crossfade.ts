export type FadeCurve = 'linear' | 'equalPower'
export const MAX_CROSSFADE = 15

export interface TransitionSettings { duration: number; curve: FadeCurve }

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

export function makeTransition(duration = 0, curve: FadeCurve = 'equalPower'): TransitionSettings {
  return { duration: clamp(duration, 0, MAX_CROSSFADE), curve }
}

/** Gains for outgoing/incoming track at progress t in 0..1. */
export function fadeGains(curve: FadeCurve, t: number): { out: number; in: number } {
  const p = clamp(t, 0, 1)
  return curve === 'linear'
    ? { out: 1 - p, in: p }
    : { out: Math.cos((p * Math.PI) / 2), in: Math.sin((p * Math.PI) / 2) }
}

/** Sampled gain curve (for WebAudio setValueCurveAtTime). */
export function fadeCurveArray(curve: FadeCurve, direction: 'out' | 'in', points = 128): Float32Array {
  const a = new Float32Array(points)
  for (let i = 0; i < points; i++) a[i] = fadeGains(curve, i / (points - 1))[direction]
  return a
}
