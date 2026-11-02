import { t as translate } from '../i18n'
import { useRef, useState } from 'preact/hooks'
import { notify, setArtwork, trackById, updateTrack } from '../state'
import { Art } from './common'

export function EditTrack({ id, onClose }: { id: string; onClose: () => void }) {
  const t = trackById.value.get(id)
  const [f, setF] = useState(() => ({ title: t?.title ?? '', artist: t?.artist ?? '', albumArtist: t?.albumArtist ?? '', album: t?.album ?? '', genre: t?.genre ?? '', composer: t?.composer ?? '', year: t?.year?.toString() ?? '', trackNo: t?.trackNo?.toString() ?? '', comment: t?.comment ?? '', lyrics: t?.lyrics ?? '', kind: t?.kind ?? 'music' }))
  const pic = useRef<HTMLInputElement>(null)
  if (!t) return null
  const field = (k: keyof typeof f, label: string, mode?: 'numeric') => (
    <label class="field"><span style={{ minWidth: 92 }}>{label}</span>
      <input value={f[k]} inputMode={mode} onInput={e => setF({ ...f, [k]: (e.target as HTMLInputElement).value })} style={{ flex: 1, minWidth: 0, background: 'none', border: 0, textAlign: 'right', outline: 0 }} /></label>
  )
  const save = async () => {
    const num = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Number(s) : undefined)
    await updateTrack(id, { title: f.title.trim() || t.title, artist: f.artist.trim() || translate("Unknown Artist"), albumArtist: f.albumArtist.trim() || undefined, album: f.album.trim() || translate("Unknown Album"), genre: f.genre.trim() || undefined, composer: f.composer.trim() || undefined, year: num(f.year), trackNo: num(f.trackNo), comment: f.comment.trim() || undefined, lyrics: f.lyrics.trim() || undefined, kind: f.kind as 'music' | 'audiobook' })
    notify(translate("Saved")); onClose()
  }
  return (
    <div class="sheet" role="dialog" aria-label={translate("Edit song info")}>
      <div class="nav" style={{ margin: '-12px -24px 8px' }}><button class="side" onClick={onClose}>{translate("Cancel")}</button><h1>{translate("Edit info")}</h1><button class="side right" onClick={save}>{translate("Save")}</button></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '8px 0' }}>
        <Art id={id} /><button class="btn small secondary" onClick={() => pic.current?.click()}>{translate("Change artwork…")}</button>
        <input ref={pic} type="file" accept="image/*" hidden onChange={async e => { const file = (e.target as HTMLInputElement).files?.[0]; if (file) { try { await setArtwork(id, file); notify(translate("Artwork updated")) } catch { notify(translate("Could not read that image")) } } }} />
      </div>
      <div class="group" style={{ margin: '8px 0' }}>
        {field('title', translate("Title"))}{field('artist', translate("Artist"))}{field('albumArtist', translate("Album artist"))}{field('album', translate("Album"))}{field('genre', translate("Genre"))}{field('composer', translate("Composer"))}{field('year', translate("Year"), 'numeric')}{field('trackNo', translate("Track #"), 'numeric')}
        <label class="field"><span>{translate("Type")}</span><select value={f.kind} onChange={e => setF({ ...f, kind: (e.target as HTMLSelectElement).value as 'music' | 'audiobook' })} style={{ background: 'var(--bg2)', border: 0, borderRadius: 8, padding: '6px 8px' }}><option value="music">{translate("Music")}</option><option value="audiobook">{translate("Audiobook")}</option></select></label>
      </div>
      <div class="hint" style={{ margin: '4px 4px 8px' }}>{translate("Edits are stored in SEAM; your original audio file is never modified.")}</div>
      <div class="group" style={{ margin: '8px 0' }}>
        <textarea placeholder={translate("Comment")} value={f.comment} onInput={e => setF({ ...f, comment: (e.target as HTMLTextAreaElement).value })} rows={2} style={{ width: '100%', background: 'none', border: 0, padding: 14, outline: 0, resize: 'vertical' }} />
      </div>
      <div class="group" style={{ margin: '8px 0' }}>
        <textarea placeholder={translate("Lyrics")} value={f.lyrics} onInput={e => setF({ ...f, lyrics: (e.target as HTMLTextAreaElement).value })} rows={8} style={{ width: '100%', background: 'none', border: 0, padding: 14, outline: 0, resize: 'vertical' }} />
      </div>
    </div>
  )
}
