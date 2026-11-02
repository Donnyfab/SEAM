import { describe, expect, it } from 'vitest'
import { fadeGains, makeTransition } from '../src/core/crossfade'
import { appendClip, effectiveOverlap, makeArrangement, makeClip, moveClip, playableDuration, setTransition, timeline, totalDuration, tracklistText, updateClip } from '../src/core/arrangement'
import { advance, makeQueue, move, previous, shuffleUpcoming, current } from '../src/core/queue'

const three = () => {
  let a = makeArrangement('EP')
  for (const [t, d] of [['A', 100], ['B', 80], ['C', 60]] as const) a = appendClip(a, makeClip({ title: t, sourceDuration: d }))
  return a
}

describe('crossfade', () => {
  it('equal power keeps constant power', () => {
    for (let t = 0; t <= 1; t += 0.1) { const g = fadeGains('equalPower', t); expect(g.out ** 2 + g.in ** 2).toBeCloseTo(1, 9) }
  })
  it('clamps duration to 0..15', () => {
    expect(makeTransition(40).duration).toBe(15)
    expect(makeTransition(-2).duration).toBe(0)
  })
})

describe('arrangement', () => {
  it('transitions track clip count', () => expect(three().transitions).toHaveLength(2))
  it('gapless timeline has no overlap', () => { const t = timeline(three()); expect([t[1]!.start, t[2]!.start]).toEqual([100, 180]) })
  it('crossfade overlaps timeline', () => {
    const a = setTransition(three(), 0, { duration: 8 }); const t = timeline(a)
    expect([t[1]!.start, t[2]!.start, totalDuration(a)]).toEqual([92, 172, 232])
  })
  it('overlap clamps to short clip', () => {
    let a = makeArrangement('x'); a = appendClip(a, makeClip({ title: 'l', sourceDuration: 100 })); a = appendClip(a, makeClip({ title: 't', sourceDuration: 3 }))
    expect(effectiveOverlap(setTransition(a, 0, { duration: 12 }), 0)).toBe(3)
  })
  it('trim is non-destructive', () => {
    const c = makeClip({ title: 'T', sourceDuration: 100, trimStart: 10, trimEnd: 90 })
    expect([playableDuration(c), c.sourceDuration]).toEqual([80, 100])
  })
  it('trim clamps to source', () => {
    const c = makeClip({ title: 'T', sourceDuration: 50, trimStart: -5, trimEnd: 999 })
    expect([c.trimStart, c.trimEnd]).toEqual([0, 50])
  })
  it('fades clamp to playable length and default to 0', () => {
    expect(makeClip({ title: 'T', sourceDuration: 10 }).fadeIn).toBe(0)
    expect(makeClip({ title: 'T', sourceDuration: 10, fadeOut: 99 }).fadeOut).toBe(10)
  })
  it('updateClip re-clamps', () => {
    const a = updateClip(three(), 0, { trimEnd: 20, fadeIn: 50 })
    expect([a.clips[0]!.trimEnd, a.clips[0]!.fadeIn]).toEqual([20, 20])
  })
  it('reorder resets transitions', () => {
    const a = moveClip(setTransition(three(), 0, { duration: 5 }), 2, 0)
    expect(a.clips.map(c => c.title)).toEqual(['C', 'A', 'B'])
    expect(a.transitions.every(t => t.duration === 0)).toBe(true)
  })
  it('JSON round trip', () => { const a = three(); expect(JSON.parse(JSON.stringify(a))).toEqual(a) })
  it('tracklist mentions transitions', () => {
    const text = tracklistText(setTransition(three(), 1, { duration: 4 }))
    expect(text).toContain('gapless cut'); expect(text).toContain('4.00s equalPower crossfade')
  })
})

describe('queue', () => {
  it('repeat one on auto only', () => {
    const q = { ...makeQueue([1, 2, 3], 1), repeat: 'one' as const }
    expect(current(advance(q, true))).toBe(2); expect(current(advance(q, false))).toBe(3)
  })
  it('repeat all wraps', () => expect(current(advance({ ...makeQueue([1, 2], 1), repeat: 'all' }, true))).toBe(1))
  it('ends without repeat', () => expect(advance(makeQueue([1], 0), true).index).toBe(0))
  it('previous at start stays', () => expect(previous(makeQueue([1, 2], 0)).index).toBe(0))
  it('move keeps current tracked', () => {
    let q = makeQueue(['a', 'b', 'c', 'd'], 1)
    q = move(q, 3, 0); expect(current(q)).toBe('b')
    q = move(q, 0, 3); expect(current(q)).toBe('b')
  })
  it('shuffle keeps current and membership', () => {
    const q = shuffleUpcoming(makeQueue(Array.from({ length: 20 }, (_, i) => i + 1), 4))
    expect(current(q)).toBe(5); expect([...q.items].sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  })
})
