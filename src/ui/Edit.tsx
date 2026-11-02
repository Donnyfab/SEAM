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
    await updateTrack(id, { title: f.title.trim() || t.title, artist: f.artist.trim() || 'Unknown Artist', albumArtist: f.albumArtist.trim() || undefined, album: f.album.trim() || 'Unknown Album', genre: f.genre.trim() || undefined, composer: f.composer.trim() || undefined, year: num(f.year), trackNo: num(f.trackNo), comment: f.comment.trim() || undefined, lyrics: f.lyrics.trim() || undefined, kind: f.kind as 'music' | 'audiobook' })
    notify('Saved'); onClose()
  }
  return (
    <div class="sheet" role="dialog" aria-label="Edit song info">
      <div class="nav" style={{ margin: '-12px -24px 8px' }}><button class="side" onClick={onClose}>Cancel</button><h1>Edit info</h1><button class="side right" onClick={save}>Save</button></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '8px 0' }}>
        <Art id={id} /><button class="btn small secondary" onClick={() => pic.current?.click()}>Change artwork…</button>
        <input ref={pic} type="file" accept="image/*" hidden onChange={async e => { const file = (e.target as HTMLInputElement).files?.[0]; if (file) { try { await setArtwork(id, file); notify('Artwork updated') } catch { notify('Could not read that image') } } }} />
      </div>
      <div class="group" style={{ margin: '8px 0' }}>
        {field('title', 'Title')}{field('artist', 'Artist')}{field('albumArtist', 'Album artist')}{field('album', 'Album')}{field('genre', 'Genre')}{field('composer', 'Composer')}{field('year', 'Year', 'numeric')}{field('trackNo', 'Track #', 'numeric')}
        <label class="field"><span>Type</span><select value={f.kind} onChange={e => setF({ ...f, kind: (e.target as HTMLSelectElement).value as 'music' | 'audiobook' })} style={{ background: 'var(--bg2)', border: 0, borderRadius: 8, padding: '6px 8px' }}><option value="music">Music</option><option value="audiobook">Audiobook</option></select></label>
      </div>
      <div class="hint" style={{ margin: '4px 4px 8px' }}>Edits are stored in SEAM; your original audio file is never modified.</div>
      <div class="group" style={{ margin: '8px 0' }}>
        <textarea placeholder="Comment" value={f.comment} onInput={e => setF({ ...f, comment: (e.target as HTMLTextAreaElement).value })} rows={2} style={{ width: '100%', background: 'none', border: 0, padding: 14, outline: 0, resize: 'vertical' }} />
      </div>
      <div class="group" style={{ margin: '8px 0' }}>
        <textarea placeholder="Lyrics" value={f.lyrics} onInput={e => setF({ ...f, lyrics: (e.target as HTMLTextAreaElement).value })} rows={8} style={{ width: '100%', background: 'none', border: 0, padding: 14, outline: 0, resize: 'vertical' }} />
      </div>
    </div>
  )
}
