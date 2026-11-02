import { createCloudAdapter, isCloud } from './cloud'
import { WebDavClient, isAudioName } from './webdav'
import { SubsonicClient, toTrackLike as subTrack } from './subsonic'
import { JellyfinClient, toTrackLike as jfTrack } from './jellyfin'

export type SourceKind = 'webdav' | 'subsonic' | 'jellyfin' | 'radio' | 'dropbox' | 'gdrive' | 'onedrive'
export interface Station { name: string; url: string }
export interface Source {
  id: string; kind: SourceKind; name: string
  url?: string; username?: string; password?: string
  /** jellyfin session */ token?: string; userId?: string
  /** cloud OAuth */ clientId?: string; accessToken?: string; refreshToken?: string; expiresAt?: number
  stations?: Station[]
}

export interface RemoteTrackMeta { title: string; artist: string; album: string; duration: number; trackNo?: number; year?: number; genre?: string }
export interface RemoteNode {
  id: string; title: string; subtitle?: string; container: boolean; size?: number
  track?: RemoteTrackMeta; fileName?: string; data?: unknown
}
export interface RemoteAdapter {
  root(): Promise<RemoteNode[]>
  children(n: RemoteNode): Promise<RemoteNode[]>
  search?(q: string): Promise<RemoteNode[]>
  blob(n: RemoteNode): Promise<Blob>
}

export class ConnectError extends Error {}

/** https pages cannot call plain-http servers (mixed content); catch it before the browser's vague "load failed". */
export function checkReachable(url: string, pageProtocol = location.protocol, pageHost = location.hostname): void {
  let u: URL
  try { u = new URL(url) } catch { throw new ConnectError('That address is not a valid URL (include https://)') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  if (pageProtocol === 'https:' && u.protocol === 'http:' && !local) {
    throw new ConnectError('Safari blocks http:// servers from an https app. Put your server behind https (for example a Tailscale/Caddy certificate) and use that address.')
  }
  void pageHost
}

export function explainNetworkError(e: unknown): string {
  if (e instanceof ConnectError) return e.message
  const msg = e instanceof Error ? e.message : String(e)
  if (/load failed|failed to fetch|networkerror/i.test(msg)) {
    return 'Could not reach the server. Check the address, and make sure the server allows cross-origin (CORS) requests from this site.'
  }
  return msg
}

const ext = (n: string) => n.split('.').pop()?.toLowerCase() ?? ''

export function createAdapter(s: Source): RemoteAdapter {
  if (isCloud(s.kind)) return createCloudAdapter(s)
  if (!s.url) throw new ConnectError('This source has no address')
  checkReachable(s.url)
  if (s.kind === 'webdav') {
    const c = new WebDavClient({ baseUrl: s.url, username: s.username, password: s.password })
    const toNode = (e: Awaited<ReturnType<WebDavClient['list']>>[number]): RemoteNode => ({ id: e.path, title: e.name, container: e.isDir, size: e.size, fileName: e.name, subtitle: e.isDir ? undefined : `${(e.size / 1e6).toFixed(1)} MB` })
    const list = async (p: string) => (await c.list(p)).filter(e => e.isDir || isAudioName(e.name)).map(toNode).sort((a, b) => Number(b.container) - Number(a.container) || a.title.localeCompare(b.title, undefined, { numeric: true }))
    return { root: () => list('/'), children: n => list(n.id), blob: n => c.get(n.id) }
  }
  if (s.kind === 'subsonic') {
    const c = new SubsonicClient({ baseUrl: s.url, username: s.username ?? '', password: s.password ?? '' })
    const songNode = (x: Parameters<typeof subTrack>[0]): RemoteNode => ({ id: x.id, title: x.title, subtitle: x.artist, container: false, track: subTrack(x), fileName: `${x.artist ?? ''} - ${x.title}.mp3` })
    return {
      root: async () => (await c.getAlbumList('alphabeticalByName', 200, 0)).map(a => ({ id: a.id, title: a.name, subtitle: a.artist, container: true })),
      children: async n => ((await c.getAlbum(n.id)).song ?? []).map(songNode),
      search: async q => { const r = await c.search(q); return [...r.album.map(a => ({ id: a.id, title: a.name, subtitle: a.artist, container: true })), ...r.song.map(songNode)] },
      blob: async n => { const r = await fetch(c.downloadUrl(n.id)); if (!r.ok) throw new ConnectError(`Server returned ${r.status}`); return r.blob() },
    }
  }
  if (s.kind === 'jellyfin') {
    const c = new JellyfinClient({ baseUrl: s.url, deviceId: 'seam-web', accessToken: s.token, userId: s.userId })
    const trackNode = (x: Parameters<typeof jfTrack>[0]): RemoteNode => { const t = jfTrack(x); return { id: t.id, title: t.title, subtitle: t.artist, container: false, track: t, fileName: `${t.artist} - ${t.title}.${ext((x as { Container?: string }).Container ?? 'mp3') || 'mp3'}` } }
    return {
      root: async () => (await c.getViews()).map(v => ({ id: v.Id, title: v.Name ?? 'Library', container: true, data: 'view' })),
      children: async n => n.data === 'view'
        ? (await c.getAlbums(n.id, 0, 300)).map(a => ({ id: a.Id, title: a.Name ?? 'Album', subtitle: a.AlbumArtist ?? undefined, container: true, data: 'album' }))
        : (await c.getAlbumTracks(n.id)).map(trackNode),
      search: async q => (await c.searchAudio(q)).map(trackNode),
      blob: async n => { const r = await fetch(c.downloadUrl(n.id)); if (!r.ok) throw new ConnectError(`Server returned ${r.status}`); return r.blob() },
    }
  }
  throw new ConnectError('Unsupported source type')
}

/** Jellyfin sign-in helper (stores the token on the source). */
export async function jellyfinLogin(s: Source): Promise<Source> {
  checkReachable(s.url ?? '')
  const c = new JellyfinClient({ baseUrl: s.url!, deviceId: 'seam-web' })
  const session = await c.authenticate(s.username ?? '', s.password ?? '')
  return { ...s, token: session.accessToken, userId: session.userId }
}

export async function testSource(s: Source): Promise<void> {
  if (s.kind === 'webdav') { checkReachable(s.url ?? ''); await new WebDavClient({ baseUrl: s.url!, username: s.username, password: s.password }).ping() }
  else if (s.kind === 'subsonic') { checkReachable(s.url ?? ''); await new SubsonicClient({ baseUrl: s.url!, username: s.username ?? '', password: s.password ?? '' }).ping() }
}
