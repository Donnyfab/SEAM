import { useLayoutEffect, useRef } from 'preact/hooks'

/**
 * Shared behaviour for every overlay (menus, sheets, dialogs): a stack so only the topmost one reacts to
 * Escape/Tab/arrows, focus moving in on open and back to the trigger on close, and a Tab trap.
 */
const stack: symbol[] = []
export const overlayOpen = () => stack.length > 0

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const visible = (el: HTMLElement) => el.getClientRects().length > 0

export interface OverlayOptions {
  /** Arrow/Home/End move between [role^=menuitem] children (menus and action sheets). */
  menu?: boolean
  /** Which element receives focus on open (defaults to the container itself, or the first item for menus). */
  initialFocus?: () => HTMLElement | null | undefined
}

export function useOverlay(ref: { current: HTMLElement | null }, onClose: () => void, opts: OverlayOptions = {}) {
  const close = useRef(onClose); close.current = onClose
  useLayoutEffect(() => {
    const id = Symbol('overlay')
    stack.push(id)
    const prev = document.activeElement as HTMLElement | null
    const el = ref.current
    const first = opts.initialFocus?.() ?? (opts.menu ? el?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])') : null)
    ;(first ?? el)?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id || e.defaultPrevented || e.isComposing) return
      const root = ref.current
      if (e.key === 'Escape') { e.preventDefault(); close.current(); return }
      if (!root) return
      if (e.key === 'Tab') {
        const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible)
        if (!items.length) { e.preventDefault(); root.focus(); return }
        const a = document.activeElement as HTMLElement | null
        const i = a ? items.indexOf(a) : -1
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); items[items.length - 1]!.focus() }
        else if (!e.shiftKey && (i === items.length - 1 || !root.contains(a))) { e.preventDefault(); items[0]!.focus() }
        return
      }
      if (opts.menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End')) {
        const items = [...root.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])')]
        if (!items.length) return
        e.preventDefault()
        const i = items.indexOf(document.activeElement as HTMLElement)
        const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1)
        items[n]!.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const at = stack.indexOf(id); if (at >= 0) stack.splice(at, 1)
      // Give focus back to whatever opened us (unless the page already moved it somewhere deliberate).
      const active = document.activeElement
      if (prev && document.contains(prev) && (!active || active === document.body || el?.contains(active))) prev.focus?.({ preventScroll: true })
    }
  }, [])
}

/**
 * Props for a dismissing backdrop: only a press that both starts and ends on the backdrop closes it, so
 * dragging a text selection out of a dialog or finishing a swipe over it never dismisses by accident.
 */
let pressedOnScrim = false
export function scrimProps(onClose: () => void) {
  return {
    onPointerDown: (e: PointerEvent) => { pressedOnScrim = e.target === e.currentTarget },
    onClick: (e: MouseEvent) => { const ok = pressedOnScrim || e.detail === 0; pressedOnScrim = false; if (e.target === e.currentTarget && ok) onClose() },
  }
}
