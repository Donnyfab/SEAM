import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { signal } from '@preact/signals'
import { t } from '../i18n'
import { Icon, type IconName } from './Icon'
import { scrimProps, useOverlay } from './overlay'

export interface GlassItem {
  label: string
  icon?: IconName
  run?: () => void
  /** opens a submenu instead of running */
  sub?: GlassItem[]
  danger?: boolean
  checked?: boolean
  disabled?: boolean
  /** thin divider above this item */
  divider?: boolean
}

/** Floating frosted menu anchored to the top-left or top-right of its positioned parent. Supports one level of submenu. */
export function GlassMenu({ items, anchor, onClose, top = 56 }: { items: GlassItem[]; anchor: 'left' | 'right'; onClose: () => void; top?: number }) {
  const [sub, setSub] = useState<GlassItem | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  // Escape steps back out of a submenu first, then closes.
  useOverlay(ref, () => (sub ? setSub(null) : onClose()), { menu: true })
  useLayoutEffect(() => { if (sub) ref.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus({ preventScroll: true }) }, [sub])
  const list = sub ? sub.sub! : items
  const press = (i: GlassItem) => {
    if (i.disabled) return
    navigator.vibrate?.(8)
    if (i.sub) setSub(i); else { onClose(); i.run?.() }
  }
  return (
    <div class="glass-scrim" {...scrimProps(onClose)} role="presentation">
      <div ref={ref} class={`glass-menu from-${anchor}`} style={{ top: `calc(var(--safe-t) + ${top}px)`, [anchor]: '12px' }} role="menu" aria-label={sub?.label}>
        {sub && <button class="glass-item back" role="menuitem" onClick={() => setSub(null)}><Icon name="chevL" size={18} /><span>{sub.label}</span></button>}
        {list.map(i => (
          <button class={`glass-item${i.danger ? ' danger' : ''}${i.divider ? ' divider' : ''}`} role={i.checked !== undefined ? 'menuitemradio' : 'menuitem'} aria-checked={i.checked} disabled={i.disabled} onClick={() => press(i)}>
            <span class="gi-icon">{i.checked ? <Icon name="check" size={20} /> : i.icon ? <Icon name={i.icon} size={22} /> : null}</span>
            <span class="gi-label">{i.label}</span>
            {i.sub && <Icon name="chevR" size={16} />}
          </button>))}
      </div>
    </div>
  )
}

/** Bottom-anchored glass sheet of actions for a row (song/playlist) — the iPhone-friendly equivalent of a context menu. */
export function GlassSheet({ title, subtitle, items, onClose }: { title?: string; subtitle?: string; items: GlassItem[]; onClose: () => void }) {
  const [sub, setSub] = useState<GlassItem | null>(null)
  const list = sub ? sub.sub! : items
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(ref, () => (sub ? setSub(null) : onClose()), { menu: true })
  return (
    <div class="glass-scrim dim" {...scrimProps(onClose)} role="presentation">
      <div ref={ref} class="glass-sheet" role="menu" aria-label={title} tabIndex={-1}>
        <div class="grab" />
        {(title || sub) && <div class="gs-head">{sub && <button aria-label={t('Back')} onClick={() => setSub(null)}><Icon name="chevL" size={18} /></button>}<div><div class="gs-title">{sub ? sub.label : title}</div>{!sub && subtitle && <div class="gs-sub">{subtitle}</div>}</div></div>}
        <div class="gs-list">{list.map(i => (
          <button class={`glass-item${i.danger ? ' danger' : ''}${i.divider ? ' divider' : ''}`} role={i.checked !== undefined ? 'menuitemradio' : 'menuitem'} aria-checked={i.checked} disabled={i.disabled} onClick={() => { if (i.sub) setSub(i); else { onClose(); i.run?.() } }}>
            <span class="gi-icon">{i.checked ? <Icon name="check" size={20} /> : i.icon ? <Icon name={i.icon} size={22} /> : null}</span><span class="gi-label">{i.label}</span>{i.sub && <Icon name="chevR" size={16} />}
          </button>))}</div>
      </div>
    </div>
  )
}

// ---- promise-based dialogs (replace window.prompt / confirm with native-feeling glass dialogs) ----
let seq = 0
interface DialogState { id: number; kind: 'text' | 'confirm'; title: string; message?: string; value?: string; placeholder?: string; ok: string; danger?: boolean; resolve: (v: string | boolean | null) => void }
const dialog = signal<DialogState | null>(null)

export function askText(o: { title: string; value?: string; placeholder?: string; ok?: string; message?: string }): Promise<string | null> {
  return new Promise(res => { dialog.value = { id: ++seq, kind: 'text', title: o.title, value: o.value ?? '', placeholder: o.placeholder, message: o.message, ok: o.ok ?? t('Save'), resolve: v => res(v as string | null) } })
}
export function askConfirm(o: { title: string; message?: string; ok: string; danger?: boolean }): Promise<boolean> {
  return new Promise(res => { dialog.value = { id: ++seq, kind: 'confirm', title: o.title, message: o.message, ok: o.ok, danger: o.danger, resolve: v => res(v === true) } })
}

export function DialogHost() {
  const d = dialog.value
  if (!d) return null
  return <Dialog key={d.id} d={d} />
}

function Dialog({ d }: { d: DialogState }) {
  const [text, setText] = useState(d.value ?? '')
  const ref = useRef<HTMLFormElement>(null)
  const finished = useRef(false)
  // Settle exactly once, however many taps or key presses arrive.
  const done = (v: string | boolean | null) => { if (finished.current) return; finished.current = true; dialog.value = null; d.resolve(v) }
  // Escape and Cancel always back out; a typed-in text dialog is not discarded by a stray tap on the backdrop.
  useOverlay(ref, () => done(null), { initialFocus: () => ref.current?.querySelector<HTMLElement>(d.kind === 'text' ? 'input' : d.danger ? 'button[type=button]' : 'button[type=submit]') })
  const dirty = d.kind === 'text' && text !== (d.value ?? '')
  return (
    <div class="glass-scrim dim center" {...scrimProps(() => { if (!dirty) done(null) })}>
      <form ref={ref} class="glass-dialog" {...({ role: d.danger ? 'alertdialog' : 'dialog' } as object)} aria-modal="true" aria-label={d.title} onSubmit={e => { e.preventDefault(); done(d.kind === 'text' ? (text.trim() || null) : true) }}>
        <div class="gd-title">{d.title}</div>
        {d.message && <div class="gd-msg">{d.message}</div>}
        {d.kind === 'text' && <input value={text} placeholder={d.placeholder} enterkeyhint="done" onInput={e => setText((e.target as HTMLInputElement).value)} />}
        <div class="gd-actions">
          <button type="button" onClick={() => done(null)}>{t('Cancel')}</button>
          <button type="submit" class={d.danger ? 'danger' : 'primary'}>{d.ok}</button>
        </div>
      </form>
    </div>
  )
}
