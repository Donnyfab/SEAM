export type RepeatMode = 'off' | 'all' | 'one'

/** Playback-order logic, independent of any audio engine. Immutable updates. */
export interface PlayQueue<T> { items: T[]; index: number | null; repeat: RepeatMode }

export const makeQueue = <T,>(items: T[] = [], start = 0): PlayQueue<T> =>
  ({ items, index: items.length ? Math.min(Math.max(start, 0), items.length - 1) : null, repeat: 'off' })

export const current = <T,>(q: PlayQueue<T>): T | undefined => (q.index === null ? undefined : q.items[q.index])

/** Index that follows the current one; `auto` = natural end-of-track (repeat-one applies). */
export function nextIndex<T>(q: PlayQueue<T>, auto: boolean): number | null {
  if (q.index === null) return null
  if (auto && q.repeat === 'one') return q.index
  if (q.index + 1 < q.items.length) return q.index + 1
  return q.repeat === 'all' ? 0 : null
}

export function advance<T>(q: PlayQueue<T>, auto: boolean): PlayQueue<T> {
  const n = nextIndex(q, auto)
  return n === null ? q : { ...q, index: n }
}

export function previous<T>(q: PlayQueue<T>): PlayQueue<T> {
  if (q.index === null) return q
  if (q.index > 0) return { ...q, index: q.index - 1 }
  return q.repeat === 'all' ? { ...q, index: q.items.length - 1 } : q
}

export function move<T>(q: PlayQueue<T>, from: number, to: number): PlayQueue<T> {
  if (from === to || !(from in q.items) || to < 0 || to >= q.items.length) return q
  const items = [...q.items]
  const [x] = items.splice(from, 1)
  items.splice(to, 0, x as T)
  let index = q.index
  if (index !== null) {
    if (index === from) index = to
    else if (from < index && to >= index) index -= 1
    else if (from > index && to <= index) index += 1
  }
  return { ...q, items, index }
}

/** Shuffles upcoming items only; current track stays put. */
export function shuffleUpcoming<T>(q: PlayQueue<T>, rand: () => number = Math.random): PlayQueue<T> {
  if (q.index === null || q.index + 1 >= q.items.length) return q
  const head = q.items.slice(0, q.index + 1)
  const tail = q.items.slice(q.index + 1)
  for (let i = tail.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[tail[i], tail[j]] = [tail[j]!, tail[i]!]
  }
  return { ...q, items: [...head, ...tail] }
}
