import { afterEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ cleanups: [] as (() => void)[] }))
vi.mock('preact/hooks', () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void | (() => void)) => { const cleanup = effect(); if (cleanup) host.cleanups.push(cleanup) },
}))
vi.mock('../src/ui/overlay', () => ({ useOverlay: vi.fn() }))
vi.mock('../src/state', () => ({ artworkUrl: vi.fn() }))
import { useSheet } from '../src/ui/common'

afterEach(() => { host.cleanups.splice(0).forEach(cleanup => cleanup()); vi.useRealTimers() })

function setup() {
  const close = vi.fn()
  const sheet = useSheet(close)
  const style = { transition: '', transform: '' }
  sheet.ref.current = { style } as unknown as HTMLDivElement
  const capture = vi.fn()
  const event = (clientY: number, pointerId = 1, isPrimary = true, button = 0) => ({ clientY, pointerId, isPrimary, button, currentTarget: { setPointerCapture: capture } }) as unknown as PointerEvent
  return { ...sheet, close, style, capture, event }
}

describe('sheet handle gestures', () => {
  it('leaves taps targeted at the nested close button', () => {
    const s = setup()
    s.grabProps.onPointerDown(s.event(20))
    s.grabProps.onPointerMove(s.event(23))
    s.grabProps.onPointerUp(s.event(23))
    expect(s.capture).not.toHaveBeenCalled()
    expect(s.style.transform).toBe('')
    expect(s.close).not.toHaveBeenCalled()
  })
  it('captures an actual drag and dismisses once after the animation', () => {
    vi.useFakeTimers()
    const s = setup()
    s.grabProps.onPointerDown(s.event(20))
    s.grabProps.onPointerMove(s.event(180))
    expect(s.capture).toHaveBeenCalledExactlyOnceWith(1)
    s.grabProps.onPointerUp(s.event(180))
    s.grabProps.onPointerUp(s.event(180))
    expect(s.style.transform).toBe('translate3d(0, 100%, 0)')
    expect(s.close).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(s.close).toHaveBeenCalledTimes(1)
  })
  it('ignores secondary touches and right mouse presses', () => {
    const s = setup()
    s.grabProps.onPointerDown(s.event(20, 1, false))
    s.grabProps.onPointerMove(s.event(200))
    s.grabProps.onPointerDown(s.event(20, 1, true, 2))
    s.grabProps.onPointerMove(s.event(200))
    expect(s.capture).not.toHaveBeenCalled()
  })
  it('ignores another pointer during a drag', () => {
    const s = setup()
    s.grabProps.onPointerDown(s.event(20))
    s.grabProps.onPointerMove(s.event(180, 2))
    s.grabProps.onPointerUp(s.event(180, 2))
    expect(s.capture).not.toHaveBeenCalled()
    s.grabProps.onPointerMove(s.event(50))
    expect(s.capture).toHaveBeenCalledTimes(1)
  })
  it('restores the sheet when the browser cancels a gesture', () => {
    const s = setup()
    s.grabProps.onPointerDown(s.event(20))
    s.grabProps.onPointerMove(s.event(180))
    s.grabProps.onPointerCancel()
    expect(s.style.transform).toBe('')
    expect(s.style.transition).toBe('')
    s.grabProps.onPointerUp(s.event(180))
    expect(s.close).not.toHaveBeenCalled()
  })
  it('does not call an old close callback after the sheet unmounts', () => {
    vi.useFakeTimers()
    const s = setup()
    s.grabProps.onPointerDown(s.event(20))
    s.grabProps.onPointerMove(s.event(180))
    s.grabProps.onPointerUp(s.event(180))
    host.cleanups.splice(0).forEach(cleanup => cleanup())
    vi.runAllTimers()
    expect(s.close).not.toHaveBeenCalled()
  })
})
