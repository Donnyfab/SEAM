import { computePeaks, detectSilenceBounds, findTransitionPoints } from '../audio/peaks'
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
      const ch = Array.from({ length: Math.min(buf.numberOfChannels, 2) }, (_, i) => buf.getChannelData(i))
      const { min, max } = computePeaks(ch, 1200)
      return { duration: buf.duration, min, max, silence: detectSilenceBounds(ch, buf.sampleRate), points: findTransitionPoints(ch, buf.sampleRate) }
    })()
    p.catch(() => cache.delete(id))
    cache.set(id, p)
  }
  return p
}
