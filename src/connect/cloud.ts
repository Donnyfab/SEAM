import { DropboxClient } from './dropbox'
import { GoogleDriveClient, isFolder } from './gdrive'
import { OneDriveClient } from './onedrive'
import { challengeFor, generateVerifier, randomState } from './pkce'
import { isAudioName } from './webdav'
import { ConnectError, type RemoteAdapter, type RemoteNode, type Source, type SourceKind } from './sources'

export type CloudKind = Extract<SourceKind, 'dropbox' | 'gdrive' | 'onedrive'>
export const isCloud = (k: SourceKind): k is CloudKind => k === 'dropbox' || k === 'gdrive' || k === 'onedrive'

const PENDING_KEY = 'seam-oauth-pending'
/** Where the provider sends the user back to; must be registered in your provider app. */
export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '')

type Tokens = { access_token: string; refresh_token?: string; expires_in?: number }
const clientFor = (kind: CloudKind, clientId: string, accessToken?: string) =>
  kind === 'dropbox' ? new DropboxClient({ clientId, accessToken }) : kind === 'gdrive' ? new GoogleDriveClient({ clientId, accessToken }) : new OneDriveClient({ clientId, accessToken })

/** Step 1: remember the PKCE verifier, then send the user to the provider's consent page. */
export async function beginAuth(kind: CloudKind, name: string, clientId: string): Promise<void> {
  if (!clientId.trim()) throw new ConnectError('Enter the Client ID from your provider app')
  const verifier = generateVerifier(), state = randomState(), challenge = await challengeFor(verifier)
  const id = crypto.randomUUID()
  localStorage.setItem(PENDING_KEY, JSON.stringify({ id, kind, name, clientId: clientId.trim(), verifier, state }))
  location.assign(clientFor(kind, clientId.trim()).authorizeUrl({ redirectUri: redirectUri(), challenge, state }))
}

/** Step 2 (on page load): exchange ?code for tokens. Returns the new source, or null when this isn't an OAuth return. */
export async function finishAuth(): Promise<Source | null> {
  const q = new URLSearchParams(location.search)
  const code = q.get('code'), state = q.get('state')
  const raw = localStorage.getItem(PENDING_KEY)
  if (!code || !state || !raw) return null
  const p = JSON.parse(raw) as { id: string; kind: CloudKind; name: string; clientId: string; verifier: string; state: string }
  history.replaceState(null, '', location.pathname)
  if (p.state !== state) throw new ConnectError('Sign-in was rejected: state mismatch')
  localStorage.removeItem(PENDING_KEY)
  const t = await (clientFor(p.kind, p.clientId).exchangeCode({ code, verifier: p.verifier, redirectUri: redirectUri() }) as Promise<Tokens>)
  return { id: p.id, kind: p.kind, name: p.name, clientId: p.clientId, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 }
}

let persist: (s: Source) => Promise<void> = async () => {}
export const setSourceSaver = (fn: (s: Source) => Promise<void>) => { persist = fn }

async function freshToken(s: Source): Promise<string> {
  if (s.accessToken && (!s.expiresAt || s.expiresAt > Date.now() + 60_000)) return s.accessToken
  if (!s.refreshToken) throw new ConnectError('Your sign-in expired. Remove this source and connect again.')
  const t = await (clientFor(s.kind as CloudKind, s.clientId!).refresh(s.refreshToken) as Promise<Tokens>)
  s.accessToken = t.access_token; s.refreshToken = t.refresh_token ?? s.refreshToken; s.expiresAt = Date.now() + (t.expires_in ?? 3600) * 1000
  await persist({ ...s })
  return s.accessToken
}

const byFolderFirst = (a: RemoteNode, b: RemoteNode) => Number(b.container) - Number(a.container) || a.title.localeCompare(b.title, undefined, { numeric: true })

export function createCloudAdapter(s: Source): RemoteAdapter {
  if (s.kind === 'dropbox') {
    const c = async () => new DropboxClient({ clientId: s.clientId!, accessToken: await freshToken(s) })
    const list = async (path: string) => {
      const cl = await c(); const out: RemoteNode[] = []; let cursor: string | undefined
      do { const r = await cl.listFolder(path, cursor); cursor = r.hasMore ? r.cursor : undefined; for (const e of r.entries) if (e.isDir || isAudioName(e.name)) out.push({ id: e.path, title: e.name, container: e.isDir, size: e.size, fileName: e.name }) } while (cursor)
      return out.sort(byFolderFirst)
    }
    return { root: () => list(''), children: n => list(n.id), blob: async n => { const url = await (await c()).temporaryLink(n.id); const r = await fetch(url); if (!r.ok) throw new ConnectError(`Dropbox returned ${r.status}`); return r.blob() } }
  }
  if (s.kind === 'gdrive') {
    const c = async () => new GoogleDriveClient({ clientId: s.clientId!, accessToken: await freshToken(s) })
    const list = async (folder: string) => {
      const cl = await c(); const out: RemoteNode[] = []; let tok: string | undefined
      do { const r = await cl.list(folder, tok); tok = r.nextPageToken; for (const f of r.files) { const dir = isFolder(f.mimeType); if (dir || isAudioName(f.name) || f.mimeType.startsWith('audio/')) out.push({ id: f.id, title: f.name, container: dir, size: f.size ? Number(f.size) : undefined, fileName: f.name }) } } while (tok)
      return out.sort(byFolderFirst)
    }
    return { root: () => list('root'), children: n => list(n.id), blob: async n => (await c()).downloadBlob(n.id) }
  }
  const c = async () => new OneDriveClient({ clientId: s.clientId!, accessToken: await freshToken(s) })
  const list = async (id: string) => {
    const cl = await c(); const out: RemoteNode[] = []; let next: string | undefined
    do { const r = await cl.listChildren(id, next); next = r.nextLink; for (const e of r.entries) if (e.isDir || isAudioName(e.name)) out.push({ id: e.id, title: e.name, container: e.isDir, size: e.size, fileName: e.name }) } while (next)
    return out.sort(byFolderFirst)
  }
  return { root: () => list('root'), children: n => list(n.id), blob: async n => (await c()).download(n.id) }
}
