import { analyzeAsync, downmixToMono } from '../audio/dspClient'
import { decodeTrack, getEngine } from '../state'

export interface TrackAnalysis {
  duration: number
  min: Float32Array
  max: Float32Array
  silence: { start: number; end: number }
  points: { time: number; kind: 'in' | 'out'; confidence: number }[]
}

const cache = new Map<string, Promise<TrackAnalysis>>()

/** Decodes the track once and keeps only the small peak summary (not the PCM). */
export function analyzeTrack(id: string): Promise<TrackAnalysis> {
  let p = cache.get(id)
  if (!p) {
    p = (async () => {
      const ctx = getEngine().ctx
      const buf = await decodeTrack(id, ctx)
      // Downmix on the main thread (cheap, one pass) and analyse the copy on a worker so the UI stays responsive.
      const mono = downmixToMono(Array.from({ length: Math.min(buf.numberOfChannels, 2) }, (_, i) => buf.getChannelData(i)))
      const r = await analyzeAsync(mono, buf.sampleRate, 1200)
      return { duration: buf.duration, min: r.min, max: r.max, silence: r.silence, points: r.points }
    })()
    p.catch(() => cache.delete(id))
    cache.set(id, p)
  }
  return p
}
