import type { HTMLAttributes, TargetedPointerEvent, TargetedKeyboardEvent } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { autoScrollDelta, computeDropIndex, shiftFor, useSortable } from '../src/ui/useSortable'

// A small hook host keeps event/lifecycle tests in node without a DOM dependency.
const host = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0,
  effects: [] as (() => void | (() => void))[],
  cleanups: [] as (() => void)[],
}))
vi.mock('preact/hooks', () => ({
  useRef: (initial: unknown) => {
    const i = host.cursor++
    return host.slots[i] ??= { current: initial }
  },
  useState: (initial: unknown) => {
    const i = host.cursor++
    if (!(i in host.slots)) host.slots[i] = initial
    return [host.slots[i], (value: unknown) => { host.slots[i] = value }]
  },
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    const i = host.cursor++
    if (!deps || !(i in host.slots)) host.effects.push(effect)
    host.slots[i] = true
  },
  useLayoutEffect: (effect: () => void | (() => void)) => { host.cursor++; host.effects.push(effect) },
}))

describe('computeDropIndex', () => {
  it('handles an empty list, single item, and unchanged displacement', () => {
    expect(computeDropIndex([], 0, 100)).toBe(0)
    expect(computeDropIndex([50], 0, -100)).toBe(0)
    expect(computeDropIndex([20, 40, 80], 1, 0)).toBe(1)
  })
  it('crosses cumulative adjacent midpoints in either direction with unequal heights', () => {
    const heights = [20, 40, 80, 30]
    expect(computeDropIndex(heights, 0, 20)).toBe(0)
    expect(computeDropIndex(heights, 0, 21)).toBe(1)
    expect(computeDropIndex(heights, 0, 80)).toBe(1)
    expect(computeDropIndex(heights, 0, 81)).toBe(2)
    expect(computeDropIndex(heights, 0, 136)).toBe(3)
    expect(computeDropIndex(heights, 3, -40)).toBe(3)
    expect(computeDropIndex(heights, 3, -41)).toBe(2)
    expect(computeDropIndex(heights, 3, -101)).toBe(1)
    expect(computeDropIndex(heights, 3, -131)).toBe(0)
  })
  it('clamps out-of-range sources and destinations and accepts collapsed rows', () => {
    expect(computeDropIndex([10, 20, 30], -10, 1000)).toBe(2)
    expect(computeDropIndex([10, 20, 30], 100, -1000)).toBe(0)
    expect(computeDropIndex([20, 0, 20], 0, 1)).toBe(1)
    expect(computeDropIndex([20, 0, 20], 0, 11)).toBe(2)
  })
  it('does not mutate measured heights', () => {
    const heights = [25, 35, 45]
    computeDropIndex(heights, 1, 100)
    expect(heights).toEqual([25, 35, 45])
  })
})

describe('shiftFor', () => {
  it('opens exactly the dragged-height gap in either direction', () => {
    expect([0, 1, 2, 3, 4].map(i => shiftFor(i, 1, 3, 37))).toEqual([0, 0, -37, -37, 0])
    expect([0, 1, 2, 3, 4].map(i => shiftFor(i, 3, 1, 37))).toEqual([0, 37, 37, 0, 0])
    expect([0, 1, 2].map(i => shiftFor(i, 1, 1, 37))).toEqual([0, 0, 0])
  })
})

describe('autoScrollDelta', () => {
  it('ramps within edges, stops in the center, and caps outside', () => {
    expect(autoScrollDelta(100, 100, 500)).toBe(-18)
    expect(autoScrollDelta(130, 100, 500)).toBe(-9)
    expect(autoScrollDelta(160, 100, 500)).toBe(0)
    expect(autoScrollDelta(300, 100, 500)).toBe(0)
    expect(autoScrollDelta(470, 100, 500)).toBe(9)
    expect(autoScrollDelta(500, 100, 500)).toBe(18)
    expect(autoScrollDelta(-500, 100, 500)).toBe(-18)
    expect(autoScrollDelta(1000, 100, 500)).toBe(18)
  })
  it('supports custom settings, small viewports, and disabled/empty ranges', () => {
    expect(autoScrollDelta(10, 0, 200, 20, 10)).toBe(-5)
    expect(autoScrollDelta(30, 0, 60)).toBe(0)
    expect(autoScrollDelta(45, 0, 60)).toBe(9)
    expect(autoScrollDelta(0, 0, 200, 0)).toBe(0)
    expect(autoScrollDelta(0, 0, 200, 60, 0)).toBe(0)
    expect(autoScrollDelta(0, 100, 100)).toBe(0)
  })
})

class ElementStub extends EventTarget {
  style = { touchAction: '' }
  parentElement: ElementStub | null = null
  handle: ElementStub | null = null
  scrollTop = 0
  scrollHeight = 500
  clientHeight = 200
  clientTop = 0
  height = 40
  captured: number | null = null
  ownerDocument!: { scrollingElement: ElementStub; documentElement: ElementStub }
  getBoundingClientRect() { return { top: 0, bottom: this.height, height: this.height } }
  querySelector() { return this.handle }
  contains(target: unknown): boolean { return target === this || target === this.handle }
  setPointerCapture(id: number) { this.captured = id }
  hasPointerCapture(id: number) { return this.captured === id }
  releasePointerCapture() { this.captured = null }
}

function attach(props: HTMLAttributes<HTMLElement>, element: ElementStub) {
  if (typeof props.ref === 'function') props.ref(element as unknown as HTMLElement)
}

function pointer(type: string, y: number, id = 1) {
  return Object.assign(new Event(type, { cancelable: true }), { pointerId: id, clientY: y, clientX: 0 })
}

function down(props: HTMLAttributes<HTMLElement>, row: ElementStub, target = row, y = 20) {
  const event = {
    isPrimary: true, button: 0, pointerId: 1, clientX: 0, clientY: y,
    currentTarget: row, target, preventDefault: vi.fn(),
  }
  if (typeof props.onPointerDown === 'function') props.onPointerDown(event as unknown as TargetedPointerEvent<HTMLElement>)
  return event
}

function key(props: HTMLAttributes<HTMLElement>, name: string, altKey = true) {
  const event = { key: name, altKey, preventDefault: vi.fn() }
  if (typeof props.onKeyDown === 'function') props.onKeyDown(event as unknown as TargetedKeyboardEvent<HTMLElement>)
  return event
}

describe('useSortable pointer and keyboard lifecycle', () => {
  let win: EventTarget
  let list: ElementStub
  let rows: ElementStub[]
  let onMove: ReturnType<typeof vi.fn<(from: number, to: number) => void>>
  let frames: Map<number, FrameRequestCallback>
  let options: { count: number; onMove: (from: number, to: number) => void; handleSelector?: string }
  function render() {
    host.cursor = 0
    const result = useSortable(options)
    attach(result.containerProps, list)
    rows.forEach((row, i) => attach(result.itemProps(i), row))
    for (const effect of host.effects.splice(0)) {
      const cleanup = effect()
      if (cleanup) host.cleanups.push(cleanup)
    }
    return result
  }
  beforeEach(() => {
    vi.useFakeTimers()
    host.slots = []; host.cursor = 0; host.effects = []; host.cleanups = []
    win = Object.assign(new EventTarget(), { innerHeight: 400 })
    list = new ElementStub()
    list.ownerDocument = { scrollingElement: list, documentElement: list }
    rows = Array.from({ length: 3 }, () => {
      const row = new ElementStub()
      row.parentElement = list
      row.ownerDocument = list.ownerDocument
      row.handle = new ElementStub()
      return row
    })
    list.contains = (target: unknown) => target === list || rows.some(row => row.contains(target))
    onMove = vi.fn()
    options = { count: 3, onMove }
    frames = new Map()
    let next = 0
    vi.stubGlobal('Node', ElementStub)
    vi.stubGlobal('window', win)
    vi.stubGlobal('navigator', { vibrate: vi.fn() })
    vi.stubGlobal('getComputedStyle', () => ({ overflowY: 'auto' }))
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  })
  afterEach(() => {
    host.cleanups.forEach(cleanup => cleanup())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  it('captures the default handle immediately and commits once on release', () => {
    const result = render()
    down(result.itemProps(0), rows[0]!)
    expect(rows[0]!.captured).toBe(1)
    expect(navigator.vibrate).toHaveBeenCalledWith(10)
    win.dispatchEvent(pointer('pointermove', 90, 2))
    expect(render().offsetY).toBe(0)
    win.dispatchEvent(pointer('pointermove', 90))
    expect(render().draggingIndex).toBe(0)
    expect(render().offsetY).toBe(70)
    expect(render().itemProps(1).style).toMatchObject({ transform: 'translateY(-40px)' })
    win.dispatchEvent(pointer('pointerup', 90))
    expect(onMove).toHaveBeenCalledExactlyOnceWith(0, 2)
    expect(rows[0]!.captured).toBeNull()
    expect(render().draggingIndex).toBeNull()
    expect(frames.size).toBe(0)
    win.dispatchEvent(pointer('pointerup', 90))
    expect(onMove).toHaveBeenCalledTimes(1)
  })
  it('limits touch-action to explicit handles and supports long press on the row', () => {
    options.handleSelector = '.handle'
    const result = render()
    expect(rows[0]!.style.touchAction).toBe('')
    expect(rows[0]!.handle!.style.touchAction).toBe('none')
    down(result.itemProps(0), rows[0]!)
    vi.advanceTimersByTime(249)
    expect(rows[0]!.handle!.captured).toBeNull()
    vi.advanceTimersByTime(1)
    expect(rows[0]!.handle!.captured).toBe(1)
    win.dispatchEvent(pointer('pointerup', 70))
    expect(onMove).toHaveBeenCalledExactlyOnceWith(0, 1)
  })
  it('starts explicit handles immediately and cancels on lost capture', () => {
    options.handleSelector = '.handle'
    const result = render()
    down(result.itemProps(0), rows[0]!, rows[0]!.handle!)
    expect(rows[0]!.handle!.captured).toBe(1)
    rows[0]!.handle!.dispatchEvent(pointer('lostpointercapture', 80))
    win.dispatchEvent(pointer('pointerup', 80))
    expect(onMove).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
  })
  it('allows scrolling to cancel a pending hold and cancels on pointercancel', () => {
    options.handleSelector = '.handle'
    down(render().itemProps(0), rows[0]!)
    win.dispatchEvent(pointer('pointermove', 30))
    vi.advanceTimersByTime(300)
    expect(navigator.vibrate).not.toHaveBeenCalled()
    down(render().itemProps(0), rows[0]!, rows[0]!.handle!)
    win.dispatchEvent(pointer('pointermove', 100))
    win.dispatchEvent(pointer('pointercancel', 100))
    expect(onMove).not.toHaveBeenCalled()
    expect(render().draggingIndex).toBeNull()
  })
  it('scrolls the nearest ancestor and includes scroll distance in displacement', () => {
    const scroller = new ElementStub()
    scroller.ownerDocument = list.ownerDocument
    list.parentElement = scroller
    list.scrollHeight = list.clientHeight
    down(render().itemProps(0), rows[0]!, rows[0]!, 190)
    const [id, frame] = [...frames][0]!
    frames.delete(id)
    frame(16)
    expect(scroller.scrollTop).toBe(15)
    expect(list.scrollTop).toBe(0)
    expect(render().offsetY).toBe(15)
  })
  it('moves with Alt+arrows and respects boundaries and unmodified keys', () => {
    const result = render()
    key(result.itemProps(0), 'ArrowUp')
    key(result.itemProps(2), 'ArrowDown')
    key(result.itemProps(1), 'ArrowUp', false)
    expect(onMove).not.toHaveBeenCalled()
    key(result.itemProps(1), 'ArrowUp')
    key(result.itemProps(1), 'ArrowDown')
    expect(onMove.mock.calls).toEqual([[1, 0], [1, 2]])
  })
  it('uses the latest callback and releases resources and handle styles on unmount', () => {
    options.handleSelector = '.handle'
    rows[0]!.handle!.style.touchAction = 'pan-y'
    down(render().itemProps(0), rows[0]!, rows[0]!.handle!)
    const updated = vi.fn()
    options = { ...options, onMove: updated }
    render()
    win.dispatchEvent(pointer('pointerup', 70))
    expect(updated).toHaveBeenCalledExactlyOnceWith(0, 1)
    down(render().itemProps(0), rows[0]!, rows[0]!.handle!)
    host.cleanups.splice(0).forEach(cleanup => cleanup())
    expect(rows[0]!.handle!.style.touchAction).toBe('pan-y')
    expect(rows[0]!.handle!.captured).toBeNull()
    expect(frames.size).toBe(0)
    win.dispatchEvent(pointer('pointerup', 100))
    expect(updated).toHaveBeenCalledTimes(1)
  })
  it('clears a pending long press on release or unmount', () => {
    options.handleSelector = '.handle'
    down(render().itemProps(0), rows[0]!)
    win.dispatchEvent(pointer('pointerup', 20))
    vi.advanceTimersByTime(300)
    expect(navigator.vibrate).not.toHaveBeenCalled()
    down(render().itemProps(0), rows[0]!)
    host.cleanups.splice(0).forEach(cleanup => cleanup())
    vi.advanceTimersByTime(300)
    expect(navigator.vibrate).not.toHaveBeenCalled()
    expect(onMove).not.toHaveBeenCalled()
  })
  it('cancels active drags when the list count changes or the window loses focus', () => {
    down(render().itemProps(0), rows[0]!)
    options.count = 2
    render()
    expect(rows[0]!.captured).toBeNull()
    expect(frames.size).toBe(0)
    down(render().itemProps(0), rows[0]!)
    win.dispatchEvent(new Event('blur'))
    expect(rows[0]!.captured).toBeNull()
    expect(onMove).not.toHaveBeenCalled()
  })
})
