import { clamp, makeTransition, type FadeCurve, type TransitionSettings } from './crossfade'

/** Non-destructive view onto a source file: only offsets are stored. */
export interface Clip {
  id: string
  title: string
  trackId?: string
  sourceDuration: number
  trimStart: number
  trimEnd: number
  fadeIn: number
  fadeOut: number
}

export function makeClip(p: { id?: string; title: string; trackId?: string; sourceDuration: number; trimStart?: number; trimEnd?: number; fadeIn?: number; fadeOut?: number }): Clip {
  const sourceDuration = Math.max(p.sourceDuration, 0)
  const end = clamp(p.trimEnd ?? sourceDuration, 0, sourceDuration)
  const trimStart = clamp(p.trimStart ?? 0, 0, end)
  const len = end - trimStart
  return {
    id: p.id ?? crypto.randomUUID(), title: p.title, trackId: p.trackId, sourceDuration,
    trimStart, trimEnd: end, fadeIn: clamp(p.fadeIn ?? 0, 0, len), fadeOut: clamp(p.fadeOut ?? 0, 0, len),
  }
}

export const playableDuration = (c: Clip) => c.trimEnd - c.trimStart

export interface PlacedClip { clip: Clip; start: number; overlapIn: number; curveIn: FadeCurve; end: number }

export interface Arrangement {
  id: string
  name: string
  clips: Clip[]
  /** transitions[i] joins clips[i] into clips[i+1] */
  transitions: TransitionSettings[]
}

export function makeArrangement(name: string, clips: Clip[] = []): Arrangement {
  return normalize({ id: crypto.randomUUID(), name, clips, transitions: [] })
}

export function normalize(a: Arrangement): Arrangement {
  const needed = Math.max(a.clips.length - 1, 0)
  const transitions = a.transitions.slice(0, needed)
  while (transitions.length < needed) transitions.push(makeTransition())
  return { ...a, transitions }
}

export const appendClip = (a: Arrangement, c: Clip) => normalize({ ...a, clips: [...a.clips, c] })

/** Reordering resets transitions: they described different pairs. */
export function moveClip(a: Arrangement, from: number, to: number): Arrangement {
  if (from === to || !a.clips[from] || to < 0 || to >= a.clips.length) return a
  const clips = [...a.clips]
  const [c] = clips.splice(from, 1)
  clips.splice(to, 0, c!)
  return normalize({ ...a, clips, transitions: [] })
}

export function removeClip(a: Arrangement, index: number): Arrangement {
  if (!a.clips[index]) return a
  return normalize({ ...a, clips: a.clips.filter((_, i) => i !== index), transitions: [] })
}

export function setTransition(a: Arrangement, index: number, t: Partial<TransitionSettings>): Arrangement {
  const cur = a.transitions[index]
  if (!cur) return a
  const transitions = [...a.transitions]
  transitions[index] = makeTransition(t.duration ?? cur.duration, t.curve ?? cur.curve)
  return { ...a, transitions }
}

export function updateClip(a: Arrangement, index: number, p: Partial<Pick<Clip, 'trimStart' | 'trimEnd' | 'fadeIn' | 'fadeOut' | 'title'>>): Arrangement {
  const c = a.clips[index]
  if (!c) return a
  const clips = [...a.clips]
  clips[index] = makeClip({ ...c, ...p })
  return { ...a, clips }
}

/** Overlap clamped so it never exceeds either neighbouring clip. */
export function effectiveOverlap(a: Arrangement, i: number): number {
  const t = a.transitions[i], x = a.clips[i], y = a.clips[i + 1]
  if (!t || !x || !y) return 0
  return Math.min(t.duration, playableDuration(x), playableDuration(y))
}

export function timeline(a: Arrangement): PlacedClip[] {
  const out: PlacedClip[] = []
  let cursor = 0
  a.clips.forEach((clip, i) => {
    const overlapIn = i === 0 ? 0 : effectiveOverlap(a, i - 1)
    const start = cursor - overlapIn
    const end = start + playableDuration(clip)
    out.push({ clip, start, overlapIn, curveIn: i === 0 ? 'linear' : a.transitions[i - 1]!.curve, end })
    cursor = end
  })
  return out
}

export const totalDuration = (a: Arrangement) => timeline(a).at(-1)?.end ?? 0

export function formatTime(t: number): string {
  const s = Math.max(0, Math.floor(t))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function tracklistText(a: Arrangement): string {
  const lines = [a.name, '-'.repeat(Math.max(a.name.length, 3))]
  timeline(a).forEach((p, i) => {
    lines.push(`${i + 1}. ${formatTime(p.start)}  ${p.clip.title}  (${formatTime(playableDuration(p.clip))})`)
    if (i + 1 < a.clips.length) {
      const eff = effectiveOverlap(a, i)
      lines.push(`     -> ${eff === 0 ? 'gapless cut' : `${eff.toFixed(2)}s ${a.transitions[i]!.curve} crossfade`}`)
    }
  })
  lines.push(`Total: ${formatTime(totalDuration(a))}`)
  return lines.join('\n')
}
