import { t as translate } from '../i18n'
import { useEffect, useRef, useState } from 'preact/hooks'
import { artworkUrl } from '../state'
import { formatTime } from '../core/arrangement'
import { overlayOpen, scrimProps, useOverlay } from './overlay'

export const fmt = formatTime

export function Art({ id, big }: { id?: string; big?: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { let live = true; setUrl(null); if (id) void artworkUrl(id, big ? 'full' : 'sm').then(u => live && setUrl(u)); return () => { live = false } }, [id, big])
  return <div class={`art${big ? ' big' : ''}`} style={url ? { backgroundImage: `url(${url})` } : undefined}>{url ? '' : '♪'}</div>
}

export interface MenuItem { label: string; run: () => void; danger?: boolean }
export function ActionMenu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(ref, onClose, { menu: true })
  return (
    <div class="menu" {...scrimProps(onClose)}>
      <div class="panel" ref={ref} role="menu" tabIndex={-1}>
        {items.map(i => <button role="menuitem" class={i.danger ? 'danger' : ''} onClick={() => { onClose(); i.run() }}>{i.label}</button>)}
        <button role="menuitem" onClick={onClose}>{translate("Cancel")}</button>
      </div>
    </div>
  )
}

export function fmtBytes(n: number) { return n > 1e9 ? translate("{value} GB", { value: (n / 1e9).toFixed(2) }) : translate("{value} MB", { value: (n / 1e6).toFixed(1) }) }

/** Save/share a file: iOS share sheet when available, otherwise a normal download. */
export async function saveBlob(blob: Blob, name: string) {
  const file = new File([blob], name, { type: blob.type })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title: name }); return } catch { /* cancelled → fall through to download */ } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
}


/**
 * Behaviour shared by full-screen sheets: focus moves in and is restored on close, Escape closes,
 * and dragging the grab handle down moves the sheet with the finger and dismisses it past a threshold.
 */
export function useSheet(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; t: number; dy: number; pointerId: number; active: boolean } | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(dismissTimer.current), [])
  useOverlay(ref, onClose)
  const grabProps = {
    // Capturing on pointerdown retargets a tap away from the nested Close button.
    onPointerDown: (e: PointerEvent) => { if (!e.isPrimary || e.button !== 0 || dismissTimer.current !== undefined) return; drag.current = { y: e.clientY, t: performance.now(), dy: 0, pointerId: e.pointerId, active: false } },
    onPointerMove: (e: PointerEvent) => {
      const d = drag.current; if (!d || !ref.current || e.pointerId !== d.pointerId) return
      d.dy = Math.max(0, e.clientY - d.y)
      if (!d.active && d.dy < 8) return
      if (!d.active) { d.active = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); ref.current.style.transition = 'none' }
      ref.current.style.transform = `translate3d(0, ${d.dy}px, 0)`
    },
    onPointerUp: (e: PointerEvent) => {
      if (e.pointerId !== drag.current?.pointerId) return
      const d = drag.current; drag.current = null; const el = ref.current
      if (!d?.active || !el) return
      const v = d.dy / Math.max(performance.now() - d.t, 1)
      el.style.transition = 'transform .28s var(--ease-out)'
      if (d.dy > 120 || v > 0.6) { el.style.transform = 'translate3d(0, 100%, 0)'; dismissTimer.current = setTimeout(onClose, 200) } else el.style.transform = ''
    },
    onPointerCancel: () => { drag.current = null; if (ref.current) { ref.current.style.transition = ''; ref.current.style.transform = '' } },
    style: { touchAction: 'none' },
  }
  return { ref, grabProps }
}

/** Debounced copy of a fast-changing value (typing in a search box). */
export function useDebounced<T>(value: T, ms = 120): T {
  const [v, setV] = useState(value)
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id) }, [value, ms])
  return v
}

/** Calls `fn` every animation frame while `active`, without re-rendering anything. */
export function useFrame(fn: () => void, active: boolean) {
  const f = useRef(fn); f.current = fn
  useEffect(() => {
    if (!active) { f.current(); return }
    let raf = 0
    const tick = () => { f.current(); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])
}

/** Re-renders only this component a few times a second (clock labels). */
export function useClock(active: boolean, ms = 250): number {
  const [, set] = useState(0)
  useEffect(() => { if (!active) return; const id = setInterval(() => set(n => n + 1), ms); return () => clearInterval(id) }, [active, ms])
  return performance.now()
}

/** True once the element has been near the viewport (used to defer image/IDB work for off-screen cards). */
export function useInView<T extends Element>(margin = '240px') {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (seen || !el) return
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setSeen(true); io.disconnect() } }, { rootMargin: margin })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen] as const
}

/** iOS-style back gesture: a rightward swipe that starts at the left edge calls `onBack` (ignored while scrolling vertically). */
export function useEdgeSwipeBack(onBack: (() => void) | null) {
  useEffect(() => {
    if (!onBack) return
    let sx = 0, sy = 0, tracking = false
    const down = (e: PointerEvent) => { tracking = e.clientX < 24 && e.pointerType !== 'mouse' && !overlayOpen(); sx = e.clientX; sy = e.clientY }
    const up = (e: PointerEvent) => {
      if (!tracking) return
      tracking = false
      const dx = e.clientX - sx, dy = Math.abs(e.clientY - sy)
      if (dx > 80 && dy < dx * 0.6) onBack()
    }
    window.addEventListener('pointerdown', down, { passive: true }); window.addEventListener('pointerup', up, { passive: true })
    return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up) }
  }, [onBack])
}
