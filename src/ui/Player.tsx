import { t as translate } from '../i18n'
import { useEffect, useRef, useState } from 'preact/hooks'
import { addBookmark, engineState, getEngine, queueIds, settings, shuffle, trackById, updateSettings, toggleFavorite } from '../state'
import { Art, fmt } from './common'
import { Visualizer } from './Visualizer'

function usePosition(active: boolean) {
  const [pos, setPos] = useState(0)
  useEffect(() => {
    if (!active) return
    let raf = 0
    const tick = () => { setPos(getEngine().position()); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])
  return pos
}

export function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const s = engineState.value
  const id = queueIds.value[s.index]
  const t = id ? trackById.value.get(id) : undefined
  const pos = usePosition(s.status === 'playing')
  if (!t) return null
  const e = getEngine()
  return (
    <div class="mini">
      <div style={{ cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', flex: 1, minWidth: 0 }} onClick={onOpen}>
        <Art id={t.id} />
        <div class="meta"><div class="t" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div><div class="s" style={{ color: 'var(--fg2)', fontSize: 13 }}>{t.artist}</div></div>
      </div>
      <button class="ctl" aria-label={s.status === 'playing' ? translate("Pause") : translate("Play")} onClick={() => void e.toggle()}>{s.status === 'playing' ? '❚❚' : '▶'}</button>
      <button class="ctl" aria-label={translate("Next")} onClick={() => void e.next()}>⏭</button>
      <div class="prog" style={{ width: `${s.duration ? (pos / s.duration) * 100 : 0}%` }} />
    </div>
  )
}

export function NowPlaying({ onClose }: { onClose: () => void }) {
  const s = engineState.value
  const id = queueIds.value[s.index]
  const t = id ? trackById.value.get(id) : undefined
  const e = getEngine()
  const pos = usePosition(s.status === 'playing' || s.status === 'paused')
  const [drag, setDrag] = useState<number | null>(null)
  const [lyrics, setLyrics] = useState(false)
  const shown = drag ?? pos
  const dur = s.duration || t?.duration || 0
  if (!t) return null
  return (
    <div class="sheet" role="dialog" aria-label={translate("Now playing")}>
      <button class="grab" aria-label={translate("Close")} onClick={onClose} style={{ height: 22, background: 'none' }}><div class="grab" style={{ margin: '0 auto' }} /></button>
      {lyrics && t.lyrics ? <div class="group" style={{ margin: 0, padding: 16, whiteSpace: 'pre-wrap', maxHeight: '45vh', overflowY: 'auto' }}>{t.lyrics}</div> : <div style={{ maxWidth: 360, width: '100%', margin: '0 auto' }}><Art id={t.id} big /></div>}
      <Visualizer />
      <div class="np-title">{t.title}</div>
      <div class="np-sub">{t.artist} — {t.album}</div>
      <div style={{ marginTop: 14 }}>
        <input type="range" aria-label={translate("Seek")} min={0} max={Math.max(dur, 1)} step={0.1} value={shown}
          style={{ '--p': `${dur ? (shown / dur) * 100 : 0}%` } as never}
          onInput={ev => setDrag(Number((ev.target as HTMLInputElement).value))}
          onChange={ev => { void e.seek(Number((ev.target as HTMLInputElement).value)); setDrag(null) }} />
        <div class="times"><span>{fmt(shown)}</span><span>-{fmt(Math.max(dur - shown, 0))}</span></div>
      </div>
      <div class="controls">
        <button aria-label={translate("Previous")} onClick={() => void e.previous()}>⏮</button>
        <button class="play" aria-label={s.status === 'playing' ? translate("Pause") : translate("Play")} onClick={() => void e.toggle()}>{s.status === 'playing' ? '⏸' : '▶'}</button>
        <button aria-label={translate("Next")} onClick={() => void e.next()}>⏭</button>
      </div>
      <div class="toggles" style={{ flexWrap: 'wrap', rowGap: 10 }}>
        <button class={shuffle.value ? 'on' : ''} onClick={() => { shuffle.value = !shuffle.value }}>{translate("Shuffle")}</button>
        <button class={settings.value.repeat !== 'off' ? 'on' : ''} onClick={() => void updateSettings({ repeat: settings.value.repeat === 'off' ? 'all' : settings.value.repeat === 'all' ? 'one' : 'off' })}>{translate("Repeat: ")}{translate(settings.value.repeat)}</button>
        {t.lyrics && <button class={lyrics ? 'on' : ''} onClick={() => setLyrics(!lyrics)}>{translate("Lyrics")}</button>}
        <button onClick={() => void addBookmark(t.id, getEngine().position())}>{translate("🔖 Bookmark")}</button>
        <button class={t.favorite ? 'on' : ''} onClick={() => void toggleFavorite(t.id)}>{t.favorite ? translate("♥ Favorite") : translate("♡ Favorite")}</button>
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
      <div class="group" style={{ margin: 0 }}>
        {queueIds.value.map((qid, i) => { const q = trackById.value.get(qid); return q ? (
          <button class={`row${i === s.index ? ' active' : ''}`} onClick={() => void e.play(i)}>
            <Art id={q.id} /><div class="grow"><div class="t">{q.title}</div><div class="s">{q.artist}</div></div><span class="s num">{fmt(q.duration)}</span>
          </button>) : null })}
      </div>
    </div>
  )
}
