import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { signal } from '@preact/signals'
import { t } from '../i18n'
import { Icon, type IconName } from './Icon'

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') (sub ? setSub(null) : onClose()) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sub])
  useLayoutEffect(() => { ref.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true }) }, [sub])
  const list = sub ? sub.sub! : items
  const press = (i: GlassItem) => {
    if (i.disabled) return
    navigator.vibrate?.(8)
    if (i.sub) setSub(i); else { onClose(); i.run?.() }
  }
  return (
    <div class="glass-scrim" onClick={onClose} role="presentation">
      <div ref={ref} class={`glass-menu from-${anchor}`} style={{ top: `calc(var(--safe-t) + ${top}px)`, [anchor]: '12px' }} role="menu" onClick={e => e.stopPropagation()}>
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
  return (
    <div class="glass-scrim dim" onClick={onClose} role="presentation">
      <div class="glass-sheet" role="menu" onClick={e => e.stopPropagation()}>
        <div class="grab" />
        {(title || sub) && <div class="gs-head">{sub && <button aria-label={t('Back')} onClick={() => setSub(null)}><Icon name="chevL" size={18} /></button>}<div><div class="gs-title">{sub ? sub.label : title}</div>{!sub && subtitle && <div class="gs-sub">{subtitle}</div>}</div></div>}
        <div class="gs-list">{list.map(i => (
          <button class={`glass-item${i.danger ? ' danger' : ''}${i.divider ? ' divider' : ''}`} role="menuitem" disabled={i.disabled} onClick={() => { if (i.sub) setSub(i); else { onClose(); i.run?.() } }}>
            <span class="gi-icon">{i.checked ? <Icon name="check" size={20} /> : i.icon ? <Icon name={i.icon} size={22} /> : null}</span><span class="gi-label">{i.label}</span>{i.sub && <Icon name="chevR" size={16} />}
          </button>))}</div>
      </div>
    </div>
  )
}

// ---- promise-based dialogs (replace window.prompt / confirm with native-feeling glass dialogs) ----
interface DialogState { kind: 'text' | 'confirm'; title: string; message?: string; value?: string; placeholder?: string; ok: string; danger?: boolean; resolve: (v: string | boolean | null) => void }
const dialog = signal<DialogState | null>(null)

export function askText(o: { title: string; value?: string; placeholder?: string; ok?: string; message?: string }): Promise<string | null> {
  return new Promise(res => { dialog.value = { kind: 'text', title: o.title, value: o.value ?? '', placeholder: o.placeholder, message: o.message, ok: o.ok ?? t('Save'), resolve: v => res(v as string | null) } })
}
export function askConfirm(o: { title: string; message?: string; ok: string; danger?: boolean }): Promise<boolean> {
  return new Promise(res => { dialog.value = { kind: 'confirm', title: o.title, message: o.message, ok: o.ok, danger: o.danger, resolve: v => res(v === true) } })
}

export function DialogHost() {
  const d = dialog.value
  const [text, setText] = useState('')
  useEffect(() => { setText(d?.value ?? '') }, [d])
  if (!d) return null
  const done = (v: string | boolean | null) => { dialog.value = null; d.resolve(v) }
  return (
    <div class="glass-scrim dim center" onClick={() => done(null)}>
      <form class="glass-dialog" aria-label={d.title} onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); done(d.kind === 'text' ? (text.trim() || null) : true) }}>
        <div class="gd-title">{d.title}</div>
        {d.message && <div class="gd-msg">{d.message}</div>}
        {d.kind === 'text' && <input autofocus value={text} placeholder={d.placeholder} onInput={e => setText((e.target as HTMLInputElement).value)} />}
        <div class="gd-actions">
          <button type="button" onClick={() => done(null)}>{t('Cancel')}</button>
          <button type="submit" class={d.danger ? 'danger' : 'primary'}>{d.ok}</button>
        </div>
      </form>
    </div>
  )
}
