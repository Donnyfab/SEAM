import { t as translate } from '../i18n'
import { useEffect, useState } from 'preact/hooks'
import { addBookmark, bookState, bookmarks, getBook, removeBookmark, settings, trackById, updateSettings } from '../state'
import { sleepTimer } from '../audio/bookPlayer'
import { Art, fmt, useSheet } from './common'

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5]
const hms = (t: number) => { const s = Math.max(0, Math.floor(t)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : fmt(s) }

export function MiniBook({ onOpen }: { onOpen: () => void }) {
  const s = bookState.value, t = s.trackId ? (trackById.value.get(s.trackId) ?? (s.meta ? { id: s.meta.id, title: s.meta.title, artist: s.meta.artist } : undefined)) : undefined
  if (!t || s.status === 'idle') return null
  const b = getBook()
  return (
    <div class="mini">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onOpen}>
        <Art id={t.id} /><div class="meta"><div class="t" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div><div class="s" style={{ color: 'var(--fg2)', fontSize: 13 }}>{s.live ? translate("Live stream") : translate("{value} left · {rate}×", { value: hms(s.duration - s.position), rate: s.rate })}</div></div>
      </div>
      <button class="ctl" aria-label={translate("Back 15 seconds")} onClick={() => b.skip(-settings.value.skipBack)}>↺</button>
      <button class="ctl" aria-label={s.status === 'playing' ? translate("Pause") : translate("Play")} onClick={() => void b.toggle()}>{s.status === 'playing' ? '❚❚' : '▶'}</button>
      <div class="prog" style={{ width: `${s.duration ? (s.position / s.duration) * 100 : 0}%` }} />
    </div>
  )
}

export function BookSheet({ onClose }: { onClose: () => void }) {
  const s = bookState.value, t = s.trackId ? (trackById.value.get(s.trackId) ?? (s.meta ? { id: s.meta.id, title: s.meta.title, artist: s.meta.artist, kind: 'stream' as const } : undefined)) : undefined
  const b = getBook()
  const { ref, grabProps } = useSheet(onClose)
  const [drag, setDrag] = useState<number | null>(null)
  const [sleep, setSleep] = useState<number | null>(null)
  const [cancel, setCancel] = useState<(() => void) | null>(null)
  useEffect(() => () => cancel?.(), [cancel])
  if (!t) return null
  const shown = drag ?? s.position
  const marks = bookmarks.value.filter(m => m.trackId === t.id).sort((x, y) => x.time - y.time)
  const setTimer = (m: number | null) => { cancel?.(); setSleep(m); setCancel(m ? () => sleepTimer(m, () => { b.pause(); setSleep(null) }) : null) }
  const rate = (r: number) => { b.setRate(r); void updateSettings({ bookRate: r }) }
  return (
    <div class="sheet" role="dialog" aria-modal="true" aria-label={translate("Audiobook player")} ref={ref} tabIndex={-1}>
      <div class="grab-area" {...(grabProps as object)}><button class="grab-btn" aria-label={translate("Close")} onClick={onClose}><div class="grab" /></button></div>
      <div style={{ maxWidth: 360, width: '100%', margin: '0 auto' }}><Art id={t.id} big /></div>
      <div class="np-title">{t.title}</div><div class="np-sub">{t.artist}</div>
      {!s.live && <div style={{ marginTop: 14 }}>
        <input type="range" aria-label={translate("Seek")} min={0} max={Math.max(s.duration, 1)} step={1} value={shown} style={{ '--p': `${s.duration ? (shown / s.duration) * 100 : 0}%` } as never}
          onInput={e => setDrag(Number((e.target as HTMLInputElement).value))} onChange={e => { b.seek(Number((e.target as HTMLInputElement).value)); setDrag(null) }} />
        <div class="times"><span>{hms(shown)}</span><span>-{hms(Math.max(s.duration - shown, 0) / s.rate)}{translate(" at ")}{s.rate}×</span></div>
      </div>}
      <div class="controls" style={{ gap: 26 }}>
        <button aria-label={translate("Back {skipBack} seconds", { skipBack: settings.value.skipBack })} onClick={() => b.skip(-settings.value.skipBack)}>↺<span style={{ fontSize: 12 }}>{settings.value.skipBack}</span></button>
        <button class="play" aria-label={s.status === 'playing' ? translate("Pause") : translate("Play")} onClick={() => void b.toggle()}>{s.status === 'playing' ? '⏸' : '▶'}</button>
        <button aria-label={translate("Forward {skipForward} seconds", { skipForward: settings.value.skipForward })} onClick={() => b.skip(settings.value.skipForward)}>↻<span style={{ fontSize: 12 }}>{settings.value.skipForward}</span></button>
      </div>
      <div class="hint" style={{ margin: '0 0 4px' }}>{translate("Speed (pitch stays natural)")}</div>
      <div class="seg" style={{ margin: '0 0 10px', overflowX: 'auto' }}>{RATES.map(r => <button class={s.rate === r ? 'on' : ''} onClick={() => rate(r)}>{r}×</button>)}</div>
      <div class="seg" style={{ margin: '0 0 10px' }} aria-label={translate("Sleep timer")}>
        {[null, 15, 30, 60].map(m => <button class={sleep === m ? 'on' : ''} onClick={() => setTimer(m)}>{m ? translate("{m} min", { m: m }) : translate("No timer")}</button>)}
      </div>
      <button class="btn secondary" onClick={() => void addBookmark(t.id, b.position(), `${t.title} · ${hms(b.position())}`)}>{translate("＋ Add bookmark here")}</button>
      {marks.length > 0 && <div class="group" style={{ margin: '14px 0 0' }}>{marks.map(m => (
        <div class="row" style={{ padding: 0 }}><button class="row" style={{ flex: 1 }} onClick={() => b.seek(m.time)}><div class="grow"><div class="t">{m.label}</div><div class="s">{hms(m.time)}</div></div></button>
          <button aria-label={translate("Delete bookmark")} style={{ padding: '0 16px', color: 'var(--danger)' }} onClick={() => void removeBookmark(m.id)}>✕</button></div>))}</div>}
    </div>
  )
}
