import { effectiveOverlap, playableDuration, timeline, type Arrangement } from '../core/arrangement'
import { buildEnvelope, needsEnvelope, type EnvelopeSpec } from './envelope'
import { pcmBytes, wavHeader } from './wav'

/** Envelope parameters for clip `i` of an arrangement (pure; shared by preview and export). */
export function envelopeSpecFor(a: Arrangement, i: number): EnvelopeSpec {
  const clip = a.clips[i]!
  const overlapIn = i > 0 ? effectiveOverlap(a, i - 1) : 0
  const overlapOut = i < a.clips.length - 1 ? effectiveOverlap(a, i) : 0
  return {
    duration: playableDuration(clip),
    overlapIn, curveIn: i > 0 ? a.transitions[i - 1]!.curve : 'equalPower',
    overlapOut, curveOut: i < a.clips.length - 1 ? a.transitions[i]!.curve : 'equalPower',
    fadeIn: clip.fadeIn, fadeOut: clip.fadeOut,
  }
}

export interface RenderOptions { sampleRate: number; bitDepth?: 16 | 24 | 32; onProgress?: (done: number, total: number) => void }

/**
 * Renders the arrangement to a WAV Blob, one clip at a time so only a single decoded track
 * (plus its overlap tail) is held in memory. Timing is frame-accurate to the timeline.
 */
export async function renderMix(a: Arrangement, decode: (trackId: string) => Promise<AudioBuffer>, opts: RenderOptions): Promise<Blob> {
  const sr = opts.sampleRate, depth = opts.bitDepth ?? 16, channels = 2
  const tl = timeline(a)
  const totalFrames = Math.round((tl.at(-1)?.end ?? 0) * sr)
  const parts: BlobPart[] = [wavHeader(totalFrames, channels, sr, depth)]
  let carry: Float32Array[] | null = null
  let written = 0

  for (let i = 0; i < tl.length; i++) {
    const p = tl[i]!
    const buf = await decode(p.clip.trackId ?? p.clip.id)
    const n = Math.max(1, Math.round(playableDuration(p.clip) * sr))
    const off = new OfflineAudioContext(channels, n, sr)
    const src = off.createBufferSource(); src.buffer = buf
    const gain = off.createGain()
    src.connect(gain).connect(off.destination)
    const spec = envelopeSpecFor(a, i)
    if (needsEnvelope(spec)) { const env = buildEnvelope(spec); gain.gain.setValueAtTime(env[0]!, 0); gain.gain.setValueCurveAtTime(env, 0, spec.duration) }
    src.start(0, p.clip.trimStart, playableDuration(p.clip))
    const rendered = await off.startRendering()
    const data = [rendered.getChannelData(0).slice(), rendered.getChannelData(Math.min(1, rendered.numberOfChannels - 1)).slice()]
    if (carry) for (let c = 0; c < channels; c++) { const d = data[c]!, k = carry[c]!; for (let j = 0; j < Math.min(k.length, d.length); j++) d[j]! += k[j]! }
    const startFrame = Math.round(p.start * sr)
    const nextStart = i + 1 < tl.length ? Math.round(tl[i + 1]!.start * sr) : startFrame + n
    const emit = Math.max(0, Math.min(nextStart, startFrame + n) - startFrame)
    parts.push(pcmBytes(data, depth, 0, emit))
    written += emit
    carry = data.map(ch => ch.slice(emit))
    opts.onProgress?.(i + 1, tl.length)
  }
  if (written !== totalFrames) throw new Error(`render length mismatch: wrote ${written}, expected ${totalFrames}`)
  return new Blob(parts, { type: 'audio/wav' })
}
