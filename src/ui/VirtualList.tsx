import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChild } from 'preact'
import { computeWindow, type VirtualWindow } from './virtual'

/**
 * Renders only the rows near the viewport of the nearest page or sheet scroller. Rows must share one fixed height.
 * Keeps the DOM small (tens of nodes instead of tens of thousands) so scrolling and tab switches stay fast on phones.
 */
export function VirtualList<T>({ items, rowHeight = 56, overscan = 8, keyOf, render }: { items: readonly T[]; rowHeight?: number; overscan?: number; keyOf: (x: T) => string; render: (x: T, i: number) => ComponentChild }) {
  const host = useRef<HTMLDivElement>(null)
  const [win, setWin] = useState<VirtualWindow>(() => computeWindow(0, 800, 0, rowHeight, items.length, overscan))
  const scroller = useRef<HTMLElement | null>(null)

  const measure = () => {
    const el = host.current, sc = scroller.current
    if (!el || !sc) return
    const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
    const next = computeWindow(sc.scrollTop, sc.clientHeight, top, rowHeight, items.length, overscan)
    setWin(w => (w.first === next.first && w.last === next.last && w.padBottom === next.padBottom ? w : next))
  }

  useLayoutEffect(() => { scroller.current = host.current?.closest<HTMLElement>('.sheet, .view') ?? null; measure() }, [items.length, rowHeight])
  useEffect(() => {
    const sc = scroller.current; if (!sc) return
    let raf = 0
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; measure() }) }
    sc.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { sc.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); cancelAnimationFrame(raf) }
  }, [items.length, rowHeight])

  return (
    <div ref={host} role="list" style={{ paddingTop: `${win.padTop}px`, paddingBottom: `${win.padBottom}px` }}>
      {items.slice(win.first, win.last).map((x, k) => <div class="vrow" role="listitem" key={keyOf(x)} style={{ height: `${rowHeight}px` }}>{render(x, win.first + k)}</div>)}
    </div>
  )
}
