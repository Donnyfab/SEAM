/** Pure windowing maths for fixed-height virtual lists (kept DOM-free so it can be unit-tested). */
export interface VirtualWindow { first: number; last: number; padTop: number; padBottom: number }

export function computeWindow(scrollTop: number, viewportH: number, listTop: number, rowH: number, count: number, overscan = 8): VirtualWindow {
  if (count <= 0 || rowH <= 0) return { first: 0, last: 0, padTop: 0, padBottom: 0 }
  const rel = scrollTop - listTop
  const first = Math.min(Math.max(Math.floor(rel / rowH) - overscan, 0), count)
  const last = Math.min(Math.max(Math.ceil((rel + viewportH) / rowH) + overscan, first), count)
  return { first, last, padTop: first * rowH, padBottom: (count - last) * rowH }
}

/** Only change the rendered slice when it moves by a whole chunk, so small scrolls do not re-render. */
export function sameWindow(a: VirtualWindow, b: VirtualWindow, slack = 3): boolean {
  return Math.abs(a.first - b.first) < slack && Math.abs(a.last - b.last) < slack && a.padBottom >= 0 && b.padBottom >= 0 && a.last - a.first === b.last - b.first
}
