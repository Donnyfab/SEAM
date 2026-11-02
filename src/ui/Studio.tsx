import { t as translate } from '../i18n'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { signal } from '@preact/signals'
import {
  appendClip, effectiveOverlap, formatTime, makeArrangement, makeClip, moveClip, playableDuration, removeClip, setTransition,
  timeline, totalDuration, tracklistText, updateClip, type Arrangement,
} from '../core/arrangement'
import { arrangements, decodeTrackUncached, engineState, getEngine, notify, playingArrangement, setArrangements, trackById, tracks } from '../state'
import { renderMix } from '../audio/render'
import { analyzeTrack, type TrackAnalysis } from '../studio/analysis'
import { playArrangement, previewTransition } from '../studio/playback'
import { Art, fmt, saveBlob } from './common'

const currentId = signal<string | null>(null)
const selected = signal(0)
const fx = (n: number, d = 2) => n.toFixed(d)

function Waveform({ a, index, onChange }: { a: TrackAnalysis | null; index: number; onChange: (p: { trimStart?: number; trimEnd?: number }) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drag = useRef<'s' | 'e' | null>(null)
  const clip = arrangements.value.find(x => x.id === currentId.value)?.clips[index]
  useEffect(() => {
    const c = ref.current; if (!c || !a || !clip) return
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight
    c.width = w * dpr; c.height = h * dpr
    const g = c.getContext('2d')!; g.scale(dpr, dpr); g.clearRect(0, 0, w, h)
    const n = a.max.length, mid = h / 2
    g.fillStyle = getComputedStyle(c).getPropertyValue('--accent') || '#0a84ff'
    for (let x = 0; x < w; x++) {
      const i = Math.min(n - 1, Math.floor((x / w) * n))
      const top = mid - a.max[i]! * mid, bot = mid - a.min[i]! * mid
      g.fillRect(x, top, 1, Math.max(1, bot - top))
    }
    const sx = (clip.trimStart / a.duration) * w, ex = (clip.trimEnd / a.duration) * w
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, sx, h); g.fillRect(ex, 0, w - ex, h)
    g.fillStyle = '#fff'; g.fillRect(sx - 1, 0, 3, h); g.fillRect(ex - 1, 0, 3, h)
    for (const p of a.points) { const x = (p.time / a.duration) * w; g.fillStyle = p.kind === 'out' ? '#ff9f0a' : '#30d158'; g.fillRect(x, 0, 2, 10) }
  }, [a, clip?.trimStart, clip?.trimEnd, clip?.id])
  if (!clip) return null
  const pos = (e: PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * (a?.duration ?? clip.sourceDuration) }
  return (
    <div class="studio-wave">
      <canvas ref={ref} aria-label={translate("Waveform with trim handles")}
        onPointerDown={e => { if (!a) return; const t = pos(e); drag.current = Math.abs(t - clip.trimStart) < Math.abs(t - clip.trimEnd) ? 's' : 'e'; (e.target as Element).setPointerCapture(e.pointerId); onChange(drag.current === 's' ? { trimStart: t } : { trimEnd: t }) }}
        onPointerMove={e => { if (!drag.current) return; const t = pos(e); onChange(drag.current === 's' ? { trimStart: Math.min(t, clip.trimEnd - 0.5) } : { trimEnd: Math.max(t, clip.trimStart + 0.5) }) }}
        onPointerUp={() => { drag.current = null }} />
      {!a && <div class="s" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--fg2)' }}>{translate("Analysing…")}</div>}
    </div>
  )
}

function AddTracks({ onAdd, onClose }: { onAdd: (ids: string[]) => void; onClose: () => void }) {
  const [pick, setPick] = useState<string[]>([])
  return (
    <div class="sheet">
      <div class="nav" style={{ margin: '-12px -24px 8px', position: 'sticky' }}><button class="side" onClick={onClose}>{translate("Cancel")}</button><h1>{translate("Add songs")}</h1><button class="side right" disabled={!pick.length} onClick={() => { onAdd(pick); onClose() }}>{translate("Add ")}{pick.length || ''}</button></div>
      {!tracks.value.length && <div class="empty">{translate("Import music in Files first.")}</div>}
      <div class="group" style={{ margin: 0 }}>{tracks.value.map(t => (
        <button class={`row${pick.includes(t.id) ? ' active' : ''}`} onClick={() => setPick(p => (p.includes(t.id) ? p.filter(x => x !== t.id) : [...p, t.id]))}>
          <Art id={t.id} /><div class="grow"><div class="t">{t.title}</div><div class="s">{t.artist} · {fmt(t.duration)}</div></div><span>{pick.includes(t.id) ? `✓ ${pick.indexOf(t.id) + 1}` : ''}</span>
        </button>))}</div>
    </div>
  )
}

export function Studio() {
  const list = arrangements.value
  const a = list.find(x => x.id === currentId.value) ?? list[0]
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<TrackAnalysis | null>(null)
  const sel = Math.min(selected.value, Math.max((a?.clips.length ?? 1) - 1, 0))
  const selClip = a?.clips[sel]
  const [playhead, setPlayhead] = useState(0)
  const es = engineState.value

  useEffect(() => { if (a && currentId.value !== a.id) currentId.value = a.id }, [a?.id])
  useEffect(() => {
    setAnalysis(null)
    const id = selClip?.trackId
    if (!id) return
    let live = true
    analyzeTrack(id).then(r => live && setAnalysis(r)).catch(() => live && notify(translate("Could not decode that track")))
    return () => { live = false }
  }, [selClip?.trackId])
  useEffect(() => {
    if (es.status !== 'playing' || !a) return
    let raf = 0
    const tl = timeline(a)
    const tick = () => { const p = tl[es.index]; setPlayhead(p ? p.start + getEngine().position() : 0); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [es.status, es.index, a])

  const tl = useMemo(() => (a ? timeline(a) : []), [a])
  const total = a ? totalDuration(a) : 0
  const pps = Math.min(40, Math.max(3, 700 / Math.max(total, 1)))

  const commit = (next: Arrangement) => void setArrangements(list.map(x => (x.id === next.id ? next : x)))
  const create = (name?: string) => {
    const n = name ?? prompt(translate("Name this arrangement"), translate("Sequence {value}", { value: list.length + 1 }))
    if (!n) return
    const fresh = makeArrangement(n)
    currentId.value = fresh.id; selected.value = 0
    void setArrangements([...list, fresh])
  }

  if (!a) {
    return (
      <>
        <div class="large-title">{translate("Studio")}</div>
        <div class="empty">{translate("Arrange unreleased songs into an EP, tune every transition and preview the result.")}<br /><br /><button class="btn" onClick={() => create(translate("My EP"))}>{translate("Start an arrangement")}</button></div>
      </>
    )
  }

  const addTracks = (ids: string[]) => {
    let next = a
    for (const id of ids) { const t = trackById.value.get(id); if (t) next = appendClip(next, makeClip({ title: t.title, trackId: t.id, sourceDuration: t.duration })) }
    commit(next)
  }

  const exportMix = async () => {
    if (!a.clips.length) return
    const missing = a.clips.filter(c => !c.trackId || !trackById.value.has(c.trackId))
    if (missing.length) return notify(translate("Can't export: {value} was deleted from the library", { value: missing.map(c => c.title).join(', ') }))
    setBusy(translate("Rendering 0%"))
    try {
      const ctx = getEngine().ctx
      const blob = await renderMix(a, id => decodeTrackUncached(id, ctx), { sampleRate: ctx.sampleRate, bitDepth: 16, onProgress: (d, t) => setBusy(translate("Rendering {value}%", { value: Math.round((d / t) * 100) })) })
      await saveBlob(blob, translate('{name} - preview mix.wav', { name: a.name }))
      notify(translate("Mix ready ({value} MB)", { value: (blob.size / 1e6).toFixed(0) }))
    } catch (e) { notify(translate("Render failed: {value}", { value: e instanceof Error ? e.message : String(e) })) }
    setBusy(null)
  }

  const exportInfo = () => {
    const text = tracklistText(a)
    void saveBlob(new Blob([text], { type: 'text/plain' }), translate('{name} - tracklist.txt', { name: a.name }))
  }
  const exportJson = () => {
    const doc = { name: a.name, totalSeconds: totalDuration(a), clips: a.clips.map((c, i) => ({ ...c, start: tl[i]?.start, transitionToNext: a.transitions[i] ? { ...a.transitions[i], effectiveOverlap: effectiveOverlap(a, i) } : null })) }
    void saveBlob(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), translate('{name} - arrangement.json', { name: a.name }))
  }

  const playingThis = es.status === 'playing' && playingArrangement.value === a.id

  return (
    <>
      <div class="large-title">{translate("Studio")}</div>
      <div class="actions">
        <select aria-label={translate("Arrangement")} value={a.id} onChange={e => { currentId.value = (e.target as HTMLSelectElement).value; selected.value = 0 }} style={{ background: 'var(--bg2)', border: 0, borderRadius: 8, padding: '8px 10px', width: '100%' }}>
          {list.map(x => <option value={x.id}>{x.name}</option>)}
        </select>
        <button class="btn small secondary" onClick={() => create()}>{translate("New")}</button>
        <button class="btn small secondary" onClick={() => { const n = prompt(translate("Rename"), a.name); if (n) commit({ ...a, name: n }) }}>{translate("Rename")}</button>
        <button class="btn small secondary" onClick={() => { const copy = { ...a, id: crypto.randomUUID(), name: translate("{name} copy", { name: a.name }), clips: a.clips.map(c => ({ ...c, id: crypto.randomUUID() })) }; currentId.value = copy.id; void setArrangements([...list, copy]) }}>{translate("Duplicate")}</button>
        <button class="btn small danger" onClick={() => { if (confirm(translate("Delete “{name}”?", { name: a.name }))) { currentId.value = null; void setArrangements(list.filter(x => x.id !== a.id)) } }}>{translate("Delete")}</button>
      </div>

      <div class="actions">
        <button class="btn small" disabled={!a.clips.length} onClick={() => (playingThis ? void getEngine().pause() : void playArrangement(a, 0))}>{playingThis ? translate("❚❚ Pause") : translate("▶ Play all")}</button>
        <button class="btn small secondary" onClick={() => setAdding(true)}>{translate("＋ Add songs")}</button>
        <span class="s num" style={{ marginLeft: 'auto', alignSelf: 'center', color: 'var(--fg2)' }}>{a.clips.length}{translate(" tracks · ")}{formatTime(total)}</span>
      </div>

      <div class="hint" style={{ margin: '0 16px 6px' }}>{translate("Studio preview is dry — no EQ, effects or volume normalization — so it matches the exported mix.")}</div>
      {!a.clips.length && <div class="empty">{translate("Add songs to build your sequence.")}</div>}
      {a.clips.length > 0 && (
        <div class="timeline" aria-label={translate("Arrangement timeline")}>
          <div class="lane" style={{ width: Math.max(total * pps, 10) }}>
            {tl.map((p, i) => (
              <>
                <button class={`clipbox${i === sel ? ' sel' : ''}`} style={{ left: p.start * pps, width: Math.max((p.end - p.start) * pps, 6) }} onClick={() => { selected.value = i }}>{i + 1}. {p.clip.title}</button>
                {p.overlapIn > 0 && <div class="ov" style={{ left: p.start * pps, width: p.overlapIn * pps }} />}
              </>))}
            {playingThis && <div class="playhead" style={{ left: playhead * pps }} />}
          </div>
        </div>
      )}

      {selClip && (
        <div class="group" style={{ padding: 14 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sel + 1}. {selClip.title}</strong>
            <button class="btn small secondary" disabled={sel === 0} onClick={() => { commit(moveClip(a, sel, sel - 1)); selected.value = sel - 1 }} aria-label={translate("Move earlier")}>↑</button>
            <button class="btn small secondary" disabled={sel >= a.clips.length - 1} onClick={() => { commit(moveClip(a, sel, sel + 1)); selected.value = sel + 1 }} aria-label={translate("Move later")}>↓</button>
            <button class="btn small danger" onClick={() => { commit(removeClip(a, sel)); selected.value = Math.max(0, sel - 1) }} aria-label={translate("Remove")}>✕</button>
          </div>
          <Waveform a={analysis} index={sel} onChange={p => commit(updateClip(a, sel, p))} />
          <div class="hint" style={{ margin: '6px 0' }}>{translate("Drag to set start/end. Original file is never changed. ")}<span style={{ color: '#30d158' }}>▮</span>{translate(" suggested start · ")}<span style={{ color: '#ff9f0a' }}>▮</span>{translate(" suggested end.")}</div>
          <div class="kv" style={{ padding: '4px 0' }}><span>{translate("Start")}</span><span class="num">{fx(selClip.trimStart)}{translate("s")}</span></div>
          <div class="kv" style={{ padding: '4px 0' }}><span>{translate("End")}</span><span class="num">{fx(selClip.trimEnd)}{translate("s")}</span></div>
          {analysis && <div class="actions" style={{ padding: '6px 0' }}>
            <button class="btn small secondary" onClick={() => commit(updateClip(a, sel, { trimStart: analysis.silence.start, trimEnd: analysis.silence.end }))}>{translate("Trim silence")}</button>
            {analysis.points.slice(0, 4).map(p => <button class="btn small secondary" onClick={() => commit(updateClip(a, sel, p.kind === 'in' ? { trimStart: p.time } : { trimEnd: p.time }))}>{p.kind === 'in' ? translate("Start") : translate("End")} {formatTime(p.time)}</button>)}
          </div>}
          <label class="field" style={{ padding: '6px 0' }}><span>{translate("Fade in")}</span><span class="num">{fx(selClip.fadeIn, 1)}{translate("s")}</span></label>
          <input type="range" min={0} max={Math.min(15, playableDuration(selClip))} step={0.1} value={selClip.fadeIn} style={{ '--p': `${(selClip.fadeIn / 15) * 100}%` } as never} onChange={e => commit(updateClip(a, sel, { fadeIn: Number((e.target as HTMLInputElement).value) }))} aria-label={translate("Fade in")} />
          <label class="field" style={{ padding: '6px 0' }}><span>{translate("Fade out")}</span><span class="num">{fx(selClip.fadeOut, 1)}{translate("s")}</span></label>
          <input type="range" min={0} max={Math.min(15, playableDuration(selClip))} step={0.1} value={selClip.fadeOut} style={{ '--p': `${(selClip.fadeOut / 15) * 100}%` } as never} onChange={e => commit(updateClip(a, sel, { fadeOut: Number((e.target as HTMLInputElement).value) }))} aria-label={translate("Fade out")} />
          <div class="actions" style={{ padding: '8px 0 0' }}><button class="btn small" onClick={() => void playArrangement(a, sel)}>{translate("▶ Play from here")}</button></div>
        </div>
      )}

      {a.transitions.map((t, i) => (
        <div class="tr-card">
          <h4>{i + 1}. {a.clips[i]!.title} → {a.clips[i + 1]!.title}</h4>
          <label class="field" style={{ padding: '4px 0' }}><span>{t.duration === 0 ? translate("Gapless cut") : translate("Crossfade")}</span><span class="num">{fx(t.duration)}{translate("s")}{effectiveOverlap(a, i) < t.duration ? translate(" (limited to {value}s by clip length)", { value: fx(effectiveOverlap(a, i)) }) : ''}</span></label>
          <input type="range" min={0} max={15} step={0.25} value={t.duration} style={{ '--p': `${(t.duration / 15) * 100}%` } as never} aria-label={translate("Crossfade {value}", { value: i + 1 })} onChange={e => commit(setTransition(a, i, { duration: Number((e.target as HTMLInputElement).value) }))} />
          <div class="actions" style={{ padding: '6px 0 0' }}>
            <select value={t.curve} aria-label={translate("Curve")} onChange={e => commit(setTransition(a, i, { curve: (e.target as HTMLSelectElement).value as typeof t.curve }))} style={{ background: 'var(--bg2)', border: 0, borderRadius: 8, padding: '6px 8px' }}><option value="equalPower">{translate("Equal power")}</option><option value="linear">{translate("Linear")}</option></select>
            <button class="btn small" onClick={() => void previewTransition(a, i)}>{translate("▶ Preview join")}</button>
          </div>
        </div>
      ))}

      <div class="group">
        <button class="row" disabled={!!busy || !a.clips.length} onClick={exportMix}><span class="icon" style={{ background: '#30d158' }}>⤓</span><div class="grow"><div class="t">{busy ?? translate("Export continuous mix (WAV)")}</div><div class="s">{translate("16-bit, rendered offline with exact timing")}</div></div></button>
        <button class="row" disabled={!a.clips.length} onClick={exportInfo}><span class="icon" style={{ background: '#5e5ce6' }}>☰</span><div class="grow"><div class="t">{translate("Export tracklist (text)")}</div><div class="s">{translate("Start times and transition settings")}</div></div></button>
        <button class="row" disabled={!a.clips.length} onClick={exportJson}><span class="icon" style={{ background: '#ff9f0a' }}>{'{}'}</span><div class="grow"><div class="t">{translate("Export arrangement (JSON)")}</div></div></button>
      </div>

      {list.length > 1 && (
        <>
          <div class="hint" style={{ margin: '14px 16px 0', textTransform: 'uppercase' }}>{translate("Compare sequences")}</div>
          <div class="group">{list.map(x => (
            <div class={`row${x.id === a.id ? ' active' : ''}`} style={{ padding: 0 }}>
              <button class="row" style={{ flex: 1, minWidth: 0 }} onClick={() => { currentId.value = x.id; selected.value = 0 }}><div class="grow"><div class="t">{x.name}</div><div class="s">{x.clips.map(c => c.title).join(' → ') || translate('empty')}</div></div><span class="s num">{formatTime(totalDuration(x))}</span></button>
              <button aria-label={translate("Play {name}", { name: x.name })} style={{ padding: '0 16px', color: 'var(--accent)' }} onClick={() => void playArrangement(x, 0)}>▶</button>
            </div>))}</div>
        </>
      )}
      {adding && <AddTracks onAdd={addTracks} onClose={() => setAdding(false)} />}
    </>
  )
}
