import { t as translate } from '../i18n'
import { useRef, useState } from 'preact/hooks'
import { addBookmark, engineState, getEngine, queueIds, settings, shuffle, trackById, updateSettings, toggleFavorite } from '../state'
import { Art, fmt, useClock, useFrame, useSheet } from './common'
import { Visualizer } from './Visualizer'


/** Thin progress line: written straight to the DOM each frame, so playback never re-renders the component tree. */
function ProgressLine() {
  const el = useRef<HTMLDivElement>(null)
  useFrame(() => {
    const s = engineState.peek(); const e = el.current
    if (e) e.style.transform = `scaleX(${s.duration ? Math.min(getEngine().position() / s.duration, 1) : 0})`
  }, engineState.value.status === 'playing')
  return <div class="prog" ref={el} />
}

export function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const s = engineState.value
  const id = queueIds.value[s.index]
  const t = id ? trackById.value.get(id) : undefined
  if (!t) return null
  const e = getEngine()
  return (
    <div class="mini">
      <button class="mini-main" onClick={onOpen} aria-label={translate("Now playing")}>
        <Art id={t.id} />
        <span class="meta"><span class="t">{t.title}</span><span class="s">{s.status === 'loading' ? translate('Loading…') : t.artist}</span></span>
      </button>
      <button class="ctl" aria-label={s.status === 'playing' ? translate("Pause") : translate("Play")} onClick={() => void e.toggle()}>{s.status === 'loading' ? <span class="spinner" /> : s.status === 'playing' ? '❚❚' : '▶'}</button>
      <button class="ctl" aria-label={translate("Next")} onClick={() => void e.next()}>⏭</button>
      <ProgressLine />
    </div>
  )
}

/** Range input whose thumb follows playback via direct DOM writes (no re-render) and the finger while dragging. */
function Scrubber({ duration }: { duration: number }) {
  const el = useRef<HTMLInputElement>(null)
  const dragging = useRef(false)
  const e = getEngine()
  const paint = (v: number) => { const i = el.current; if (!i) return; i.value = String(v); i.style.setProperty('--p', `${duration ? (v / duration) * 100 : 0}%`) }
  useFrame(() => { if (!dragging.current) paint(e.position()) }, engineState.value.status === 'playing')
  return (
    <input ref={el} type="range" aria-label={translate("Seek")} min={0} max={Math.max(duration, 1)} step={0.1} defaultValue={0}
      onPointerDown={() => { dragging.current = true }}
      onInput={ev => paint(Number((ev.target as HTMLInputElement).value))}
      onChange={ev => { void e.seek(Number((ev.target as HTMLInputElement).value)); dragging.current = false }}
      onPointerUp={() => { setTimeout(() => { dragging.current = false }, 50) }} />
  )
}

/** The only part of the sheet that re-renders on a timer (4 Hz). */
function Times({ duration }: { duration: number }) {
  useClock(engineState.value.status === 'playing')
  const pos = Math.min(getEngine().position(), duration || Infinity)
  return <div class="times"><span>{fmt(pos)}</span><span>-{fmt(Math.max(duration - pos, 0))}</span></div>
}

function QueueList({ index }: { index: number }) {
  const e = getEngine()
  return (
    <div class="group" style={{ margin: 0 }}>
      {queueIds.value.map((qid, i) => { const q = trackById.value.get(qid); return q ? (
        <button class={`row${i === index ? ' active' : ''}`} onClick={() => void e.play(i)}>
          <Art id={q.id} /><div class="grow"><div class="t">{q.title}</div><div class="s">{q.artist}</div></div><span class="s num">{fmt(q.duration)}</span>
        </button>) : null })}
    </div>
  )
}

export function NowPlaying({ onClose }: { onClose: () => void }) {
  const s = engineState.value
  const id = queueIds.value[s.index]
  const t = id ? trackById.value.get(id) : undefined
  const e = getEngine()
  const [lyrics, setLyrics] = useState(false)
  const { ref, grabProps } = useSheet(onClose)
  const dur = s.duration || t?.duration || 0
  if (!t) return null
  return (
    <div class="sheet" role="dialog" aria-modal="true" aria-label={translate("Now playing")} ref={ref} tabIndex={-1}>
      <div class="grab-area" {...(grabProps as object)}><button class="grab-btn" aria-label={translate("Close")} onClick={onClose}><div class="grab" /></button></div>
      {lyrics && t.lyrics ? <div class="group" style={{ margin: 0, padding: 16, whiteSpace: 'pre-wrap', maxHeight: '45vh', overflowY: 'auto' }}>{t.lyrics}</div> : <div style={{ maxWidth: 360, width: '100%', margin: '0 auto' }}><Art id={t.id} big /></div>}
      <Visualizer />
      <h2 class="np-title">{t.title}</h2>
      <div class="np-sub">{t.artist} — {t.album}</div>
      <div style={{ marginTop: 14 }}>
        <Scrubber duration={dur} />
        <Times duration={dur} />
      </div>
      <div class="controls">
        <button aria-label={translate("Previous")} onClick={() => void e.previous()}>⏮</button>
        <button class="play" aria-label={s.status === 'playing' ? translate("Pause") : translate("Play")} onClick={() => void e.toggle()}>{s.status === 'loading' ? <span class="spinner big" /> : s.status === 'playing' ? '⏸' : '▶'}</button>
        <button aria-label={translate("Next")} onClick={() => void e.next()}>⏭</button>
      </div>
      <div class="toggles" style={{ flexWrap: 'wrap', rowGap: 10 }}>
        <button class={shuffle.value ? 'on' : ''} aria-pressed={shuffle.value} onClick={() => { shuffle.value = !shuffle.value }}>{translate("Shuffle")}</button>
        <button class={settings.value.repeat !== 'off' ? 'on' : ''} onClick={() => void updateSettings({ repeat: settings.value.repeat === 'off' ? 'all' : settings.value.repeat === 'all' ? 'one' : 'off' })}>{translate("Repeat: ")}{translate(settings.value.repeat)}</button>
        {t.lyrics && <button class={lyrics ? 'on' : ''} aria-pressed={lyrics} onClick={() => setLyrics(!lyrics)}>{translate("Lyrics")}</button>}
        <button onClick={() => void addBookmark(t.id, getEngine().position())}>{translate("🔖 Bookmark")}</button>
        <button class={t.favorite ? 'on' : ''} aria-pressed={t.favorite} onClick={() => void toggleFavorite(t.id)}>{t.favorite ? translate("♥ Favorite") : translate("♡ Favorite")}</button>
      </div>
      <div class="group" style={{ margin: '18px 0 0' }}>
        <label class="field"><span>{translate("Crossfade")}</span><span class="num">{settings.value.crossfade === 0 ? translate("Off (gapless)") : translate('{value}s', { value: settings.value.crossfade })}</span></label>
        <div style={{ padding: '0 14px 10px' }}>
          <input type="range" aria-label={translate("Crossfade seconds")} min={0} max={15} step={1} value={settings.value.crossfade}
            style={{ '--p': `${(settings.value.crossfade / 15) * 100}%` } as never}
            onChange={ev => void updateSettings({ crossfade: Number((ev.target as HTMLInputElement).value) })} />
        </div>
      </div>
      <div class="hint" style={{ margin: '8px 4px' }}>{translate("The join that is already scheduled keeps its old setting; later joins use the new value (seeking applies it right away). 0 s plays tracks back-to-back with no gap.")}</div>
      <h3 style={{ margin: '12px 0 4px' }}>{translate("Up next")}</h3>
      <QueueList index={s.index} />
    </div>
  )
}
