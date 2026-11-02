import { t as translate } from '../i18n'
import { useEffect, useRef, useState } from 'preact/hooks'
import { downloadRemote, notify, playRemote, playStream, removeSource, saveSource, sources } from '../state'
import { createAdapter, explainNetworkError, jellyfinLogin, testSource, type RemoteAdapter, type RemoteNode, type Source, type SourceKind } from '../connect/sources'
import { parseM3U, parsePLS } from '../connect/playlists'
import { beginAuth, isCloud, redirectUri } from '../connect/cloud'
import { fmtBytes } from './common'

const KINDS: { kind: SourceKind; label: string; icon: string; color: string; hint: string }[] = [
  { kind: 'webdav', label: 'WebDAV / NAS / Nextcloud', icon: '☁', color: '#0a84ff', hint: 'Synology, Nextcloud, Apache, rclone serve webdav…' },
  { kind: 'subsonic', label: 'Subsonic / Navidrome', icon: '♪', color: '#ff9f0a', hint: 'Navidrome, Airsonic, Gonic, Subsonic' },
  { kind: 'jellyfin', label: 'Jellyfin', icon: '▶', color: '#8e5cd9', hint: 'Your Jellyfin server' },
  { kind: 'dropbox', label: 'Dropbox', icon: '◆', color: '#0061ff', hint: 'Sign in with your own free Dropbox app (Client ID)' },
  { kind: 'gdrive', label: 'Google Drive', icon: '▲', color: '#34a853', hint: 'Needs your own Google Cloud OAuth Client ID' },
  { kind: 'onedrive', label: 'OneDrive', icon: '☁', color: '#0a64ad', hint: 'Needs your own Microsoft Entra app (Client ID)' },
  { kind: 'radio', label: 'Internet radio', icon: '📻', color: '#30d158', hint: 'Stream URLs, .m3u and .pls files' },
]
const kindInfo = (k: SourceKind) => KINDS.find(x => x.kind === k)

function AddSource({ kind, onClose }: { kind: SourceKind; onClose: () => void }) {
  const [f, setF] = useState({ name: translate(kindInfo(kind)?.label ?? '').split(' ')[0] ?? '', url: '', username: '', password: '', clientId: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value })
  const save = async () => {
    setBusy(true); setErr('')
    try {
      let s: Source = { id: crypto.randomUUID(), kind, name: f.name.trim() || translate("Server"), url: f.url.trim(), username: f.username.trim(), password: f.password }
      if (isCloud(kind)) { await beginAuth(kind, f.name.trim() || kindInfo(kind)!.label, f.clientId); return }
      if (kind === 'radio') s = { id: s.id, kind, name: s.name, stations: [] }
      else {
        if (kind === 'jellyfin') s = await jellyfinLogin(s)
        await testSource(s)
      }
      await saveSource(s); notify(translate("Connected to {name}", { name: s.name })); onClose()
    } catch (e) { setErr(translate(explainNetworkError(e))) }
    setBusy(false)
  }
  const input = (k: keyof typeof f, label: string, type: 'text' | 'url' | 'password' = 'text', ph = '') => (
    <label class="field"><span style={{ minWidth: 90 }}>{label}</span>
      <input type={type as 'text'} placeholder={ph} value={f[k]} autocapitalize="off" autocomplete="off" spellcheck={false} onInput={set(k)} style={{ flex: 1, minWidth: 0, background: 'none', border: 0, textAlign: 'right', outline: 0 }} /></label>
  )
  return (
    <div class="sheet" role="dialog" aria-label={translate("Add source")}>
      <div class="nav" style={{ margin: '-12px -24px 8px' }}><button class="side" onClick={onClose}>{translate("Cancel")}</button><h1>{translate(kindInfo(kind)?.label ?? '')}</h1><button class="side right" disabled={busy} onClick={save}>{busy ? '…' : isCloud(kind) ? translate("Sign in") : translate("Connect")}</button></div>
      <div class="group" style={{ margin: '8px 0' }}>
        {input('name', translate("Name"))}
        {isCloud(kind) && input('clientId', translate("Client ID"))}
        {kind !== 'radio' && !isCloud(kind) && input('url', translate("Address"), 'url', translate('https://music.example.com'))}
        {kind !== 'radio' && !isCloud(kind) && input('username', translate("Username"))}
        {kind !== 'radio' && !isCloud(kind) && input('password', translate("Password"), 'password')}
      </div>
      {err && <div class="hint" style={{ color: 'var(--danger)' }}>{err}</div>}
      <div class="hint">{translate(kindInfo(kind)?.hint ?? '')}{translate(". Credentials are stored only on this device. ")}{kind !== 'radio' && !isCloud(kind) && translate("The server must use https:// and allow cross-origin (CORS) requests from this site.")}</div>
      {isCloud(kind) && <div class="hint">{translate("Register an app with your provider (free), choose “single-page / public client (PKCE)”, and add this redirect URI exactly:")}<br /><code style={{ userSelect: 'all', wordBreak: 'break-all' }}>{redirectUri()}</code><br />{translate("Read-only access is requested. SEAM never sees your password.")}</div>}
    </div>
  )
}

function Radio({ source, onBack }: { source: Source; onBack: () => void }) {
  const [name, setName] = useState(''), [url, setUrl] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const stations = source.stations ?? []
  const upd = (st: typeof stations) => void saveSource({ ...source, stations: st })
  const add = () => { if (!/^https?:\/\//i.test(url.trim())) return notify(translate("Enter a stream URL starting with https://")); upd([...stations, { name: name.trim() || url.trim(), url: url.trim() }]); setName(''); setUrl('') }
  const importFile = async (f: File) => {
    const text = await f.text(), entries = /\.pls$/i.test(f.name) ? parsePLS(text) : parseM3U(text)
    const ok = entries.filter(e => /^https?:\/\//i.test(e.url))
    if (!ok.length) return notify(translate("No stream URLs found in that file"))
    upd([...stations, ...ok.map(e => ({ name: e.title || e.url, url: e.url }))]); notify(translate('addedStations', { count: ok.length }))
  }
  return (
    <>
      <div class="nav"><button class="side" onClick={onBack}>{translate("‹ Back")}</button><h1>{source.name}</h1><span class="side right" /></div>
      <div class="group">{stations.map((st, i) => (
        <div class="row" style={{ padding: 0 }}><button class="row" style={{ flex: 1, minWidth: 0 }} onClick={() => void playStream(st.name, st.url)}><span class="icon" style={{ background: '#30d158' }}>▶</span><div class="grow"><div class="t">{st.name}</div><div class="s">{st.url}</div></div></button>
          <button aria-label={translate("Remove station")} style={{ padding: '0 16px', color: 'var(--danger)' }} onClick={() => upd(stations.filter((_, j) => j !== i))}>✕</button></div>))}
        {!stations.length && <div class="empty" style={{ padding: 28 }}>{translate("No stations yet.")}</div>}</div>
      <div class="group">
        <label class="field"><span>{translate("Name")}</span><input value={name} onInput={e => setName((e.target as HTMLInputElement).value)} style={{ flex: 1, background: 'none', border: 0, textAlign: 'right', outline: 0 }} /></label>
        <label class="field"><span>{translate("Stream URL")}</span><input value={url} type="url" autocapitalize="off" placeholder={translate("https://…")} onInput={e => setUrl((e.target as HTMLInputElement).value)} style={{ flex: 1, minWidth: 0, background: 'none', border: 0, textAlign: 'right', outline: 0 }} /></label>
        <button class="row" style={{ color: 'var(--accent)' }} onClick={add}>{translate("Add station")}</button>
        <button class="row" style={{ color: 'var(--accent)' }} onClick={() => file.current?.click()}>{translate("Import .m3u / .pls file…")}</button>
        <input ref={file} type="file" accept=".m3u,.m3u8,.pls,audio/x-mpegurl" hidden onChange={e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void importFile(f); (e.target as HTMLInputElement).value = '' }} />
      </div>
      <div class="hint">{translate("Streams must be https://. Live metadata (song titles) isn’t available because browsers block reading it without server support.")}</div>
    </>
  )
}

function Browser({ source, onBack }: { source: Source; onBack: () => void }) {
  const [adapter, setAdapter] = useState<RemoteAdapter | null>(null)
  const [path, setPath] = useState<RemoteNode[]>([])
  const [items, setItems] = useState<RemoteNode[] | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [prog, setProg] = useState<string | null>(null)

  const load = async (fn: () => Promise<RemoteNode[]>) => { setItems(null); setErr(''); try { setItems(await fn()) } catch (e) { setErr(translate(explainNetworkError(e))); setItems([]) } }
  useEffect(() => { try { const a = createAdapter(source); setAdapter(a); void load(() => a.root()) } catch (e) { setErr(translate(explainNetworkError(e))); setItems([]) } }, [source.id])

  const open = (n: RemoteNode) => { if (!adapter) return; setPath([...path, n]); void load(() => adapter.children(n)) }
  const up = () => {
    if (!path.length) return onBack()
    const next = path.slice(0, -1); setPath(next)
    if (adapter) void load(() => (next.length ? adapter.children(next.at(-1)!) : adapter.root()))
  }
  const tracks = (items ?? []).filter(n => !n.container)
  const download = async (nodes: RemoteNode[]) => {
    setProg(translate("Downloading 0/{length}…", { length: nodes.length }))
    try { await downloadRemote(source, nodes, (d, t) => setProg(translate("Downloading {d}/{t}…", { d: d, t: t }))) } catch (e) { notify(translate(explainNetworkError(e))) }
    setProg(null)
  }
  return (
    <>
      <div class="nav"><button class="side" onClick={up}>{translate("‹ Back")}</button><h1 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{path.at(-1)?.title ?? source.name}</h1><span class="side right" /></div>
      {adapter?.search && !path.length && <input class="search" type="search" placeholder={translate("Search server")} value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} onKeyDown={e => { if (e.key === 'Enter' && q.trim()) void load(() => adapter.search!(q.trim())) }} />}
      {tracks.length > 0 && <div class="actions">
        <button class="btn small" onClick={() => void playRemote(source, tracks, 0)}>{translate("▶ Play ")}{tracks.length}</button>
        <button class="btn small secondary" disabled={!!prog} onClick={() => void download(tracks)}>{translate("⤓ Download all")}</button>
        {prog && <span class="s" style={{ alignSelf: 'center', color: 'var(--fg2)' }}>{prog}</span>}
      </div>}
      {err && <div class="empty" style={{ color: 'var(--danger)' }}>{err}</div>}
      {items === null && !err && <div class="empty">{translate("Loading…")}</div>}
      {items && !items.length && !err && <div class="empty">{translate("Nothing here.")}</div>}
      <div class="group">{(items ?? []).map(n => (
        <div class="row" style={{ padding: 0 }}>
          <button class="row" style={{ flex: 1, minWidth: 0 }} onClick={() => (n.container ? open(n) : void playRemote(source, tracks, tracks.indexOf(n)))}>
            <span class="icon" style={{ background: n.container ? '#0a84ff' : '#ff9f0a' }}>{n.container ? '▸' : '♪'}</span>
            <div class="grow"><div class="t">{n.title}</div>{n.subtitle && <div class="s">{n.subtitle}</div>}</div>{n.container && <span class="chev">›</span>}
          </button>
          {!n.container && <button aria-label={translate("Download {title}", { title: n.title })} disabled={!!prog} style={{ padding: '0 16px', color: 'var(--accent)' }} onClick={() => void download([n])}>⤓</button>}
        </div>))}</div>
      {items && items.some(n => n.size) && <div class="hint">{fmtBytes(items.reduce((s, n) => s + (n.size ?? 0), 0))}{translate(" in this folder. Playing a remote song downloads it into memory first; ⤓ keeps it in your library for offline use.")}</div>}
    </>
  )
}

export function Connect() {
  const [active, setActive] = useState<string | null>(null)
  const [adding, setAdding] = useState<SourceKind | null>(null)
  const list = sources.value
  const src = list.find(s => s.id === active)
  if (src) return src.kind === 'radio' ? <Radio source={src} onBack={() => setActive(null)} /> : <Browser source={src} onBack={() => setActive(null)} />
  return (
    <>
      <h1 class="large-title">{translate("Connect")}</h1>
      {list.length > 0 && <div class="group">{list.map(s => { const k = kindInfo(s.kind); return (
        <div class="row" style={{ padding: 0 }}>
          <button class="row" style={{ flex: 1, minWidth: 0 }} onClick={() => setActive(s.id)}><span class="icon" style={{ background: k?.color }}>{k?.icon}</span><div class="grow"><div class="t">{s.name}</div><div class="s">{translate(k?.label ?? '')}{s.url ? ` · ${s.url.replace(/^https?:\/\//, '')}` : ''}</div></div><span class="chev">›</span></button>
          <button aria-label={translate("Remove {name}", { name: s.name })} style={{ padding: '0 16px', color: 'var(--danger)' }} onClick={() => { if (confirm(translate("Remove {name}?", { name: s.name }))) void removeSource(s.id) }}>✕</button></div>) })}</div>}
      <div class="hint" style={{ margin: '14px 16px 0', textTransform: 'uppercase' }}>{translate("Add a source")}</div>
      <div class="group">{KINDS.map(k => <button class="row" onClick={() => setAdding(k.kind)}><span class="icon" style={{ background: k.color }}>{k.icon}</span><div class="grow"><div class="t">{translate(k.label)}</div><div class="s">{translate(k.hint)}</div></div><span class="chev">＋</span></button>)}</div>
      <div class="hint">{translate("Browsers can’t speak SMB, SFTP, FTP or DLNA. Most NAS devices (Synology, QNAP, Unraid…) can also expose WebDAV, and Navidrome/Jellyfin work directly. Servers need https:// and CORS.")}</div>
      {adding && <AddSource kind={adding} onClose={() => setAdding(null)} />}
    </>
  )
}
