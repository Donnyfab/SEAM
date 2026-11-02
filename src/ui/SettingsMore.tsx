import { useRef, useState } from 'preact/hooks'
import { lastfm, lastFmLogin, saveLastFm, scrobblePending, flushScrobbles } from '../connect/scrobbler'
import { createBackup, restoreBackup } from '../library/backupFile'
import { notify, reloadAll, settings, updateSettings } from '../state'
import { saveBlob } from './common'

const sel = { background: 'var(--bg2)', border: 0, borderRadius: 8, padding: '6px 8px' }

export function LastFmSettings() {
  const cfg = lastfm.value
  const [f, setF] = useState({ apiKey: '', apiSecret: '', username: '', password: '' })
  const [busy, setBusy] = useState(false)
  const field = (k: keyof typeof f, label: string, type: 'text' | 'password' = 'text') => (
    <label class="field"><span>{label}</span><input type={type as 'text'} autocapitalize="off" autocomplete="off" value={f[k]} onInput={e => setF({ ...f, [k]: (e.target as HTMLInputElement).value })} style={{ flex: 1, minWidth: 0, background: 'none', border: 0, textAlign: 'right', outline: 0 }} /></label>
  )
  if (cfg) return (
    <div class="group">
      <div class="kv"><span>Last.fm</span><span>Scrobbling as {cfg.username}</span></div>
      {scrobblePending.value > 0 && <button class="row" style={{ color: 'var(--accent)' }} onClick={() => void flushScrobbles()}>Send {scrobblePending.value} queued scrobble{scrobblePending.value === 1 ? '' : 's'} now</button>}
      <button class="row" style={{ color: 'var(--danger)' }} onClick={() => void saveLastFm(null)}>Disconnect Last.fm</button>
    </div>
  )
  return (
    <>
      <div class="group">
        {field('apiKey', 'API key')}{field('apiSecret', 'Shared secret', 'password')}{field('username', 'Username')}{field('password', 'Password', 'password')}
        <button class="row" disabled={busy} style={{ color: 'var(--accent)' }} onClick={async () => {
          setBusy(true)
          try { await saveLastFm(await lastFmLogin(f.apiKey.trim(), f.apiSecret.trim(), f.username.trim(), f.password)); setF({ apiKey: '', apiSecret: '', username: '', password: '' }); notify('Last.fm connected') }
          catch (e) { notify(e instanceof Error && /load failed|failed to fetch/i.test(e.message) ? 'Could not reach Last.fm (blocked by the browser or offline)' : e instanceof Error ? e.message : 'Last.fm sign-in failed') }
          setBusy(false)
        }}>{busy ? 'Connecting…' : 'Connect Last.fm'}</button>
      </div>
      <div class="hint">Create a free API account at last.fm/api/account/create to get a key and secret. Your password is sent only to Last.fm to obtain a session, and is not stored.</div>
    </>
  )
}

export function BackupSettings() {
  const input = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [strategy, setStrategy] = useState<'keep' | 'replace'>('keep')
  return (
    <>
      <div class="group">
        <button class="row" disabled={!!msg} onClick={async () => {
          try { setMsg('Preparing backup…'); const b = await createBackup((d, t) => setMsg(`Backing up ${d}/${t}…`)); await saveBlob(b, `SEAM backup ${new Date().toISOString().slice(0, 10)}.seambak`); notify(`Backup ready (${(b.size / 1e6).toFixed(0)} MB)`) }
          catch (e) { notify(e instanceof Error ? e.message : 'Backup failed') }
          setMsg(null)
        }}><div class="grow"><div class="t">{msg ?? 'Back up everything…'}</div><div class="s">Songs, artwork, playlists, Studio arrangements, bookmarks, settings</div></div></button>
        <label class="field"><span>When restoring</span><select value={strategy} onChange={e => setStrategy((e.target as HTMLSelectElement).value as typeof strategy)} style={sel}><option value="keep">Keep what I have</option><option value="replace">Replace with backup</option></select></label>
        <button class="row" disabled={!!msg} style={{ color: 'var(--accent)' }} onClick={() => input.current?.click()}>Restore from backup…</button>
        <input ref={input} type="file" accept=".seambak,application/octet-stream" hidden onChange={async e => {
          const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''
          if (!f) return
          try { const r = await restoreBackup(f, strategy, (d, t) => setMsg(`Restoring ${d}/${t}…`)); await reloadAll(); notify(`Restored ${r.tracks} songs, ${r.playlists} playlists, ${r.arrangements} arrangements`) }
          catch (e) { notify(e instanceof Error ? e.message : 'Restore failed') }
          setMsg(null)
        }} />
      </div>
      <div class="hint">Keep backups in Files/iCloud Drive. iOS can clear a website’s storage if the device runs low on space, so back up anything you can’t replace.</div>
    </>
  )
}

export function AccessibilitySettings() {
  const s = settings.value
  return (
    <div class="group">
      <label class="field"><span>Text size</span><select value={s.textScale} onChange={e => void updateSettings({ textScale: Number((e.target as HTMLSelectElement).value) })} style={sel}><option value={0.9}>Small</option><option value={1}>Default</option><option value={1.15}>Large</option><option value={1.3}>Larger</option><option value={1.5}>Largest</option></select></label>
      <label class="field"><span>Reduce motion</span><input type="checkbox" checked={s.reduceMotion} onChange={e => void updateSettings({ reduceMotion: (e.target as HTMLInputElement).checked })} /></label>
      <label class="field"><span>Higher contrast</span><input type="checkbox" checked={s.highContrast} onChange={e => void updateSettings({ highContrast: (e.target as HTMLInputElement).checked })} /></label>
    </div>
  )
}
