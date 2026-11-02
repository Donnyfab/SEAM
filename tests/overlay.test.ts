import { describe, expect, it, vi } from 'vitest'
import { scrimProps } from '../src/ui/overlay'

function press(target: object, currentTarget: object): PointerEvent {
  return { target, currentTarget } as unknown as PointerEvent
}
function click(target: object, currentTarget: object, detail = 1): MouseEvent {
  return { target, currentTarget, detail } as unknown as MouseEvent
}

describe('overlay backdrop dismissal', () => {
  it('dismisses a complete backdrop tap once', () => {
    const close = vi.fn(), backdrop = {}, p = scrimProps(close)
    p.onPointerDown(press(backdrop, backdrop))
    p.onClick(click(backdrop, backdrop))
    p.onClick(click(backdrop, backdrop))
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('keeps dialog clicks and text-selection drags open', () => {
    const close = vi.fn(), backdrop = {}, child = {}, p = scrimProps(close)
    p.onPointerDown(press(child, backdrop))
    p.onClick(click(child, backdrop))
    p.onPointerDown(press(child, backdrop))
    p.onClick(click(backdrop, backdrop))
    p.onPointerDown(press(backdrop, backdrop))
    p.onClick(click(child, backdrop))
    expect(close).not.toHaveBeenCalled()
  })
  it('does not reuse a cancelled gesture', () => {
    const close = vi.fn(), backdrop = {}, p = scrimProps(close)
    p.onPointerDown(press(backdrop, backdrop))
    p.onPointerCancel()
    p.onClick(click(backdrop, backdrop))
    expect(close).not.toHaveBeenCalled()
  })
  it('keeps pointer state isolated between backdrops', () => {
    const a = {}, b = {}, closeA = vi.fn(), closeB = vi.fn()
    const first = scrimProps(closeA), second = scrimProps(closeB)
    first.onPointerDown(press(a, a))
    second.onClick(click(b, b))
    first.onClick(click(a, a))
    expect(closeB).not.toHaveBeenCalled()
    expect(closeA).toHaveBeenCalledTimes(1)
  })
  it('allows an assistive-technology click without a pointer gesture', () => {
    const close = vi.fn(), backdrop = {}, p = scrimProps(close)
    p.onClick(click(backdrop, backdrop, 0))
    expect(close).toHaveBeenCalledTimes(1)
  })
})
