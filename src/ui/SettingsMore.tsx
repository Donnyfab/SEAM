import { t as translate } from '../i18n'
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
      <div class="kv"><span>{translate("Last.fm")}</span><span>{translate("Scrobbling as ")}{cfg.username}</span></div>
      {scrobblePending.value > 0 && <button class="row" style={{ color: 'var(--accent)' }} onClick={() => void flushScrobbles()}>{translate('sendScrobbles', { count: scrobblePending.value })}</button>}
      <button class="row" style={{ color: 'var(--danger)' }} onClick={() => void saveLastFm(null)}>{translate("Disconnect Last.fm")}</button>
    </div>
  )
  return (
    <>
      <div class="group">
        {field('apiKey', translate("API key"))}{field('apiSecret', translate("Shared secret"), 'password')}{field('username', translate("Username"))}{field('password', translate("Password"), 'password')}
        <button class="row" disabled={busy} style={{ color: 'var(--accent)' }} onClick={async () => {
          setBusy(true)
          try { await saveLastFm(await lastFmLogin(f.apiKey.trim(), f.apiSecret.trim(), f.username.trim(), f.password)); setF({ apiKey: '', apiSecret: '', username: '', password: '' }); notify(translate("Last.fm connected")) }
          catch (e) { notify(e instanceof Error && /load failed|failed to fetch/i.test(e.message) ? translate("Could not reach Last.fm (blocked by the browser or offline)") : e instanceof Error ? translate(e.message) : translate("Last.fm sign-in failed")) }
          setBusy(false)
        }}>{busy ? translate("Connecting…") : translate("Connect Last.fm")}</button>
      </div>
      <div class="hint">{translate("Create a free API account at last.fm/api/account/create to get a key and secret. Your password is sent only to Last.fm to obtain a session, and is not stored.")}</div>
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
          try { setMsg(translate("Preparing backup…")); const b = await createBackup((d, t) => setMsg(translate("Backing up {d}/{t}…", { d: d, t: t }))); await saveBlob(b, translate('SEAM backup {date}.seambak', { date: new Date().toISOString().slice(0, 10) })); notify(translate("Backup ready ({value} MB)", { value: (b.size / 1e6).toFixed(0) })) }
          catch (e) { notify(e instanceof Error ? translate(e.message) : translate("Backup failed")) }
          setMsg(null)
        }}><div class="grow"><div class="t">{msg ?? translate("Back up everything…")}</div><div class="s">{translate("Songs, artwork, playlists, Studio arrangements, bookmarks, settings")}</div></div></button>
        <label class="field"><span>{translate("When restoring")}</span><select value={strategy} onChange={e => setStrategy((e.target as HTMLSelectElement).value as typeof strategy)} style={sel}><option value="keep">{translate("Keep what I have")}</option><option value="replace">{translate("Replace with backup")}</option></select></label>
        <button class="row" disabled={!!msg} style={{ color: 'var(--accent)' }} onClick={() => input.current?.click()}>{translate("Restore from backup…")}</button>
        <input ref={input} type="file" accept=".seambak,application/octet-stream" hidden onChange={async e => {
          const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''
          if (!f) return
          try { const r = await restoreBackup(f, strategy, (d, t) => setMsg(translate("Restoring {d}/{t}…", { d: d, t: t }))); await reloadAll(); notify(translate("Restored {tracks} songs, {playlists} playlists, {arrangements} arrangements", { tracks: r.tracks, playlists: r.playlists, arrangements: r.arrangements })) }
          catch (e) { notify(e instanceof Error ? translate(e.message) : translate("Restore failed")) }
          setMsg(null)
        }} />
      </div>
      <div class="hint">{translate("Keep backups in Files/iCloud Drive. iOS can clear a website’s storage if the device runs low on space, so back up anything you can’t replace.")}</div>
    </>
  )
}

export function AccessibilitySettings() {
  const s = settings.value
  return (
    <div class="group">
      <label class="field"><span>{translate("Text size")}</span><select value={s.textScale} onChange={e => void updateSettings({ textScale: Number((e.target as HTMLSelectElement).value) })} style={sel}><option value={0.9}>{translate("Small")}</option><option value={1}>{translate("Default")}</option><option value={1.15}>{translate("Large")}</option><option value={1.3}>{translate("Larger")}</option><option value={1.5}>{translate("Largest")}</option></select></label>
      <label class="field"><span>{translate("Reduce motion")}</span><input type="checkbox" checked={s.reduceMotion} onChange={e => void updateSettings({ reduceMotion: (e.target as HTMLInputElement).checked })} /></label>
      <label class="field"><span>{translate("Higher contrast")}</span><input type="checkbox" checked={s.highContrast} onChange={e => void updateSettings({ highContrast: (e.target as HTMLInputElement).checked })} /></label>
    </div>
  )
}
