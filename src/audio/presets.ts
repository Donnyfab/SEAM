export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
export const EQ_RANGE_DB = 12

export interface FxSettings {
  eq: number[]            // dB per band, length 10
  preamp: number          // dB
  reverb: number          // wet 0..1
  delayMix: number        // wet 0..1
  delayTime: number       // seconds
  delayFeedback: number   // 0..0.9
  drive: number           // 0..1 (0 = bypass)
  compressor: boolean
}

export const defaultFx: FxSettings = { eq: Array(10).fill(0), preamp: 0, reverb: 0, delayMix: 0, delayTime: 0.35, delayFeedback: 0.35, drive: 0, compressor: false }

export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'Treble boost': [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  'Vocal': [-2, -2, -1, 1, 3, 3, 2, 1, 0, -1],
  'Rock': [4, 3, 1, -1, -2, 0, 2, 3, 4, 4],
  'Electronic': [5, 4, 1, 0, -2, 2, 1, 2, 4, 5],
  'Acoustic': [3, 3, 2, 1, 2, 1, 2, 3, 3, 2],
  'Loudness': [5, 3, 0, -1, -1, 0, -1, 0, 3, 5],
}

export const clampDb = (v: number) => Math.min(Math.max(v, -EQ_RANGE_DB), EQ_RANGE_DB)

export function normalizeFx(p: Partial<FxSettings> | undefined): FxSettings {
  const f = { ...defaultFx, ...(p ?? {}) }
  const eq = Array.from({ length: EQ_BANDS.length }, (_, i) => clampDb(Number(f.eq?.[i] ?? 0)))
  return {
    eq, preamp: Math.min(Math.max(f.preamp, -12), 12), reverb: Math.min(Math.max(f.reverb, 0), 1),
    delayMix: Math.min(Math.max(f.delayMix, 0), 1), delayTime: Math.min(Math.max(f.delayTime, 0.05), 1.5),
    delayFeedback: Math.min(Math.max(f.delayFeedback, 0), 0.9), drive: Math.min(Math.max(f.drive, 0), 1), compressor: !!f.compressor,
  }
}

/** Soft-clip curve for the distortion stage; drive 0..1 maps to 1x..~40x input gain. */
export function distortionCurve(drive: number, n = 1024): Float32Array {
  const k = 1 + drive * 39
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k) }
  return c
}

/** Exponentially decaying stereo noise impulse for the convolution reverb. */
export function reverbImpulse(sampleRate: number, seconds = 2.2, decay = 3, seed = 1): Float32Array[] {
  const len = Math.floor(sampleRate * seconds)
  let s = seed
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1
  return [0, 1].map(() => { const a = new Float32Array(len); for (let i = 0; i < len; i++) a[i] = rnd() * Math.pow(1 - i / len, decay); return a })
}
