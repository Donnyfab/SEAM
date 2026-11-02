import { effectiveOverlap, makeArrangement, makeClip, setTransition, type Arrangement } from '../core/arrangement'
import { makeTransition } from '../core/crossfade'
import { getEngine, queueIds, toPlayItem, trackById } from '../state'
import type { PlayItem } from '../audio/engine'

/** Plays an arrangement through the shared engine with its per-transition crossfades. */
export async function playArrangement(a: Arrangement, fromIndex = 0) {
  const items: PlayItem[] = []
  const ids: string[] = []
  for (const c of a.clips) {
    const t = c.trackId ? trackById.value.get(c.trackId) : undefined
    if (!t) continue
    items.push({ ...toPlayItem(t), trimStart: c.trimStart, trimEnd: c.trimEnd, fadeIn: c.fadeIn, fadeOut: c.fadeOut })
    ids.push(t.id)
  }
  if (!items.length) return
  const e = getEngine()
  queueIds.value = ids
  e.repeat = 'off'
  e.setItems(items)
  e.transitionAfter = i => makeTransition(effectiveOverlap(a, i), a.transitions[i]?.curve ?? 'equalPower')
  await e.play(Math.min(fromIndex, items.length - 1))
}

/** Plays only the join between clip i and i+1 with a few seconds of lead-in/out. */
export async function previewTransition(a: Arrangement, i: number, context = 6) {
  const x = a.clips[i], y = a.clips[i + 1]
  if (!x || !y) return
  const ov = effectiveOverlap(a, i)
  const mini = makeArrangement('preview', [
    makeClip({ ...x, trimStart: Math.max(x.trimStart, x.trimEnd - ov - context), fadeIn: 0 }),
    makeClip({ ...y, trimEnd: Math.min(y.trimEnd, y.trimStart + ov + context), fadeOut: 0 }),
  ])
  const t = a.transitions[i]!
  await playArrangement(setTransition(mini, 0, { duration: t.duration, curve: t.curve }), 0)
}

