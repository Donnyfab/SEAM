import { useEffect, useRef, useState } from 'preact/hooks'
import { importAudio, tracks, removeTrack, notify } from '../state'
import { fmtBytes } from './common'

export function Files() {
  const input = useRef<HTMLInputElement>(null)
  const [prog, setProg] = useState<[number, number] | null>(null)
  const [est, setEst] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null)
  const refresh = async () => {
    try { const e = await navigator.storage.estimate(); setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0, persisted: await navigator.storage.persisted() }) } catch { setEst(null) }
  }
  useEffect(() => { void refresh() }, [tracks.value.length])
  const onFiles = async (files: File[]) => {
    if (!files.length) return
    setProg([0, files.length])
    await importAudio(files, (d, t) => setProg([d, t]))
    setProg(null); void refresh()
  }
  return (
    <>
      <div class="large-title">Files</div>
      <div class="group">
        <button class="row" onClick={() => input.current?.click()}><span class="icon" style={{ background: '#0a84ff' }}>＋</span><div class="grow"><div class="t">Import music…</div><div class="s">From iPhone, iCloud Drive or any Files location</div></div></button>
        <input ref={input} type="file" multiple accept="audio/*,.flac,.m4a,.mp3,.wav,.aif,.aiff,.alac,.aac,.caf,.ogg,.opus" hidden
          onChange={e => { const el = e.target as HTMLInputElement; void onFiles([...(el.files ?? [])]); el.value = '' }} />
      </div>
      {prog && <div class="group" style={{ padding: 14 }}><div>Importing {prog[0]} / {prog[1]}…</div><div class="bar"><i style={{ width: `${(prog[0] / prog[1]) * 100}%` }} /></div></div>}
      <div class="hint">Files are copied into SEAM’s private storage on this device and play offline. iOS Safari can’t link to a folder, so each import makes a copy. Nothing is uploaded anywhere.</div>
      <div class="group">
        <div class="kv"><span>Songs</span><span>{tracks.value.length}</span></div>
        {est && <div class="kv"><span>Storage used</span><span>{fmtBytes(est.usage)} of {fmtBytes(est.quota)}</span></div>}
        {est && <div class="kv"><span>Protected from eviction</span><span>{est.persisted ? 'Yes' : 'No (iOS decides; install to Home Screen)'}</span></div>}
      </div>
      {tracks.value.length > 0 && <div class="group"><button class="row" style={{ color: 'var(--danger)' }} onClick={async () => { if (confirm('Delete every imported song from this device?')) { for (const t of [...tracks.value]) await removeTrack(t.id); notify('Library cleared'); void refresh() } }}>Delete all songs</button></div>}
    </>
  )
}
