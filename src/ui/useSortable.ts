import type { HTMLAttributes, TargetedPointerEvent } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'

/** Displacement from the dragged item's original top; cross adjacent midpoints to move. */
export function computeDropIndex(itemHeights: number[], fromIndex: number, pointerOffsetY: number): number {
  if (!itemHeights.length) return 0
  const from = Math.max(0, Math.min(itemHeights.length - 1, Math.trunc(fromIndex)))
  let distance = 0
  let to = from
  const direction = pointerOffsetY < 0 ? -1 : 1
  for (let i = from + direction; i >= 0 && i < itemHeights.length; i += direction) {
    const height = Math.max(0, itemHeights[i] ?? 0)
    if (Math.abs(pointerOffsetY) <= distance + height / 2) break
    to = i
    distance += height
  }
  return to
}

export function shiftFor(index: number, from: number, to: number, itemHeight: number): number {
  if (from < to && index > from && index <= to) return -itemHeight
  if (to < from && index >= to && index < from) return itemHeight
  return 0
}

/** Signed pixels per animation frame, with a linear ramp within each edge zone. */
export function autoScrollDelta(pointerY: number, viewportTop: number, viewportBottom: number, edge = 60, maxSpeed = 18): number {
  if (edge <= 0 || maxSpeed <= 0 || viewportBottom <= viewportTop) return 0
  const zone = Math.min(edge, (viewportBottom - viewportTop) / 2)
  if (pointerY < viewportTop + zone) return -maxSpeed * Math.min(1, (viewportTop + zone - pointerY) / zone)
  if (pointerY > viewportBottom - zone) return maxSpeed * Math.min(1, (pointerY - viewportBottom + zone) / zone)
  return 0
}

interface SortableOptions {
  count: number
  onMove: (from: number, to: number) => void
  handleSelector?: string
}

interface Drag {
  from: number
  to: number
  pointerId: number
  startY: number
  pointerY: number
  scrollStart: number
  scroll: HTMLElement
  handle: HTMLElement
  heights: number[]
  active: boolean
  stop: () => void
}

function scrollParent(element: HTMLElement): HTMLElement {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node
  }
  return (element.ownerDocument.scrollingElement ?? element.ownerDocument.documentElement) as HTMLElement
}

/** Spread containerProps on the list and itemProps(i) on each keyed row.
 * With handleSelector, the handle starts immediately and the rest of a row requires
 * a 250ms hold. Without it, each whole row is an immediate handle.
 */
export function useSortable(opts: SortableOptions): {
  containerProps: HTMLAttributes<HTMLElement>
  itemProps: (i: number) => HTMLAttributes<HTMLElement>
  draggingIndex: number | null
  offsetY: number
} {
  const latest = useRef(opts)
  latest.current = opts
  const container = useRef<HTMLElement | null>(null)
  const items = useRef(new Map<number, HTMLElement>())
  const drag = useRef<Drag | null>(null)
  const handles = useRef(new Map<HTMLElement, string>())
  const [view, setView] = useState({ index: null as number | null, offset: 0, to: 0, height: 0 })

  // Restore inline styles when handles change or leave the list.
  useLayoutEffect(() => {
    const current = new Set<HTMLElement>()
    for (const item of items.current.values()) {
      const handle = opts.handleSelector ? item.querySelector<HTMLElement>(opts.handleSelector) : item
      if (handle) current.add(handle)
    }
    for (const [handle, previous] of handles.current) {
      if (!current.has(handle)) { handle.style.touchAction = previous; handles.current.delete(handle) }
    }
    for (const handle of current) {
      if (!handles.current.has(handle)) handles.current.set(handle, handle.style.touchAction)
      handle.style.touchAction = 'none'
    }
    if (drag.current && (drag.current.heights.length !== opts.count || !container.current?.contains(drag.current.handle))) drag.current.stop()
  })

  useEffect(() => () => {
    drag.current?.stop()
    for (const [handle, previous] of handles.current) handle.style.touchAction = previous
    handles.current.clear()
  }, [])

  function start(event: TargetedPointerEvent<HTMLElement>, from: number) {
    if (drag.current || !event.isPrimary || event.button !== 0 || from < 0 || from >= latest.current.count) return
    const row = event.currentTarget
    const handle = latest.current.handleSelector ? row.querySelector<HTMLElement>(latest.current.handleSelector) : row
    if (!handle || !container.current) return
    const immediate = event.target instanceof Node && handle.contains(event.target)
    const scroll = scrollParent(container.current)
    const session: Drag = {
      from, to: from, pointerId: event.pointerId, startY: event.clientY, pointerY: event.clientY,
      scrollStart: scroll.scrollTop, scroll, handle,
      heights: Array.from({ length: latest.current.count }, (_, i) => items.current.get(i)?.getBoundingClientRect().height ?? 0),
      active: false, stop: () => finish(false),
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let frame: number | undefined
    let stopped = false

    function update() {
      const offset = session.pointerY - session.startY + scroll.scrollTop - session.scrollStart
      session.to = computeDropIndex(session.heights, from, offset)
      setView({ index: from, offset, to: session.to, height: session.heights[from] ?? 0 })
    }
    function tick() {
      if (stopped) return
      const root = scroll === scroll.ownerDocument.scrollingElement
      const rect = scroll.getBoundingClientRect()
      const top = root ? 0 : rect.top + scroll.clientTop
      const bottom = root ? window.innerHeight : top + scroll.clientHeight
      scroll.scrollTop += autoScrollDelta(session.pointerY, top, bottom)
      update()
      frame = requestAnimationFrame(tick)
    }
    function pickup() {
      if (stopped) return
      try { session.handle.setPointerCapture(session.pointerId) } catch { finish(false); return }
      session.active = true
      navigator.vibrate?.(10)
      update()
      frame = requestAnimationFrame(tick)
    }
    function finish(commit: boolean) {
      if (stopped) return
      stopped = true
      clearTimeout(timer)
      if (frame !== undefined) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      session.handle.removeEventListener('lostpointercapture', cancel)
      if (session.handle.hasPointerCapture(session.pointerId)) session.handle.releasePointerCapture(session.pointerId)
      drag.current = null
      setView({ index: null, offset: 0, to: 0, height: 0 })
      if (commit && session.active && session.to !== from) latest.current.onMove(from, session.to)
    }
    function move(e: PointerEvent) {
      if (e.pointerId !== session.pointerId) return
      session.pointerY = e.clientY
      if (!session.active) {
        if (Math.abs(e.clientY - session.startY) > 8 || Math.abs(e.clientX - event.clientX) > 8) finish(false)
        return
      }
      e.preventDefault()
      update()
    }
    function up(e: PointerEvent) {
      if (e.pointerId !== session.pointerId) return
      session.pointerY = e.clientY
      if (session.active) update()
      finish(true)
    }
    function cancel(e: Event) {
      if ('pointerId' in e && e.pointerId !== session.pointerId) return
      finish(false)
    }
    drag.current = session
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    handle.addEventListener('lostpointercapture', cancel)
    if (immediate) { event.preventDefault(); pickup() }
    else timer = setTimeout(pickup, 250)
  }

  return {
    containerProps: { ref: element => { container.current = element } },
    itemProps: i => ({
      ref: element => { if (element) items.current.set(i, element); else items.current.delete(i) },
      tabIndex: 0,
      style: {
        touchAction: opts.handleSelector ? undefined : 'none',
        transform: `translateY(${view.index === i ? view.offset : view.index === null ? 0 : shiftFor(i, view.index, view.to, view.height)}px)`,
        position: 'relative',
        zIndex: view.index === i ? 1 : undefined,
        userSelect: view.index === null ? undefined : 'none',
      },
      onPointerDown: event => start(event, i),
      onKeyDown: event => {
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || drag.current) return
        event.preventDefault()
        const to = Math.max(0, Math.min(latest.current.count - 1, i + (event.key === 'ArrowUp' ? -1 : 1)))
        if (i >= 0 && i < latest.current.count && to !== i) latest.current.onMove(i, to)
      },
    }),
    draggingIndex: view.index,
    offsetY: view.offset,
  }
}
