import { t as translate } from '../i18n'
import { useMemo, useState } from 'preact/hooks'
import { signal } from '@preact/signals'
import { bookmarks, bookState, createPlaylist, deletePlaylist, deleteTrackWithUndo, engineState, enqueue, playBook, playBookmark, playTracks, playlists, positions, queueIds, removeBookmark, toggleFavorite, tracks, trackById, updatePlaylist, updateTrack, notify, shuffle } from '../state'
import { groupAlbums, groupArtists, groupGenres, recents, searchTracks, sortTracks, unplayed, type Track, type TrackGroup } from '../library/model'
import { EditTrack } from './Edit'
import { Files } from './Files'
import { exportWithTags } from '../library/exportTags'
import { ActionMenu, Art, fmt, useDebounced } from './common'
import { askText, GlassSheet, type GlassItem } from './Glass'
import { Icon } from './Icon'
import { VirtualList } from './VirtualList'

type Page = { kind: 'root' } | { kind: 'songs' | 'favorites' | 'recents' | 'unplayed' | 'albums' | 'artists' | 'genres' | 'playlists' | 'audiobooks' | 'bookmarks' | 'files' } | { kind: 'group'; title: string; ids: string[] } | { kind: 'playlist'; id: string }
const stack = signal<Page[]>([{ kind: 'root' }])
const push = (p: Page) => { stack.value = [...stack.value, p] }
const pop = () => { if (stack.value.length > 1) stack.value = stack.value.slice(0, -1) }

const ROOT: { kind: Exclude<Page['kind'], 'root' | 'group' | 'playlist'>; label: string; icon: string; color: string }[] = [
  { kind: 'favorites', label: 'Favorites', icon: '♥', color: '#ff375f' }, { kind: 'recents', label: 'Recents', icon: '◷', color: '#0a84ff' },
  { kind: 'songs', label: 'Songs', icon: '♪', color: '#ff9f0a' }, { kind: 'unplayed', label: 'Unplayed', icon: '✦', color: '#30d158' },
  { kind: 'albums', label: 'Albums', icon: '▤', color: '#5e5ce6' }, { kind: 'artists', label: 'Artists', icon: '☺', color: '#bf5af2' },
  { kind: 'genres', label: 'Genres', icon: '♬', color: '#64d2ff' },
  { kind: 'audiobooks', label: 'Audiobooks', icon: '📖', color: '#8e6f4e' }, { kind: 'bookmarks', label: 'Bookmarks', icon: '🔖', color: '#ffd60a' },
  { kind: 'files', label: 'Import & storage', icon: '⤓', color: '#0a84ff' },
]

function SongRow({ t, list, i }: { t: Track; list: Track[]; i: number }) {
  const [menu, setMenu] = useState(false)
  const [edit, setEdit] = useState(false)
  const cur = queueIds.value[engineState.value.index] === t.id
  const items: GlassItem[] = [
    { label: translate('Play'), icon: 'play', run: () => void playTracks(list, i) },
    { label: translate('Play next'), icon: 'playNext', run: () => void enqueue([t as never], 'next') },
    { label: translate('Play later'), icon: 'later', run: () => void enqueue([t as never], 'later') },
    { label: translate('Add to playlist'), icon: 'addSong', sub: [
      { label: translate('New playlist'), icon: 'plus', run: async () => { const n = await askText({ title: translate('New playlist'), placeholder: translate('Playlist name'), ok: translate('Create') }); if (n) void createPlaylist(n, [t.id]) } },
      ...playlists.value.filter(p => !p.archived).map(p => ({ label: p.name, icon: 'music' as const, run: () => { if (!p.trackIds.includes(t.id)) void updatePlaylist(p.id, { trackIds: [...p.trackIds, t.id] }); notify(translate("Added to {name}", { name: p.name })) } })),
    ] },
    { label: t.favorite ? translate("Remove from favorites") : translate("Add to favorites"), icon: 'heart', run: () => void toggleFavorite(t.id) },
    { label: translate("Edit info…"), icon: 'edit', run: () => setEdit(true) },
    { label: translate("Export file with edited tags (MP3/FLAC)"), icon: 'export', run: () => void exportWithTags(t.id) },
    { label: translate("Delete from library"), icon: 'trash', danger: true, divider: true, run: () => deleteTrackWithUndo(t.id) },
  ]
  return (
    <>
      <div class={`row${cur ? ' active' : ''}`} style={{ padding: 0 }}>
        <button class="row" style={{ flex: 1, minWidth: 0, height: '100%' }} onClick={() => void playTracks(list, i)}>
          <Art id={t.id} />
          <div class="grow"><div class="t">{t.favorite ? '♥ ' : ''}{t.title}</div><div class="s">{t.artist} · {t.album}</div></div>
          <span class="s num">{fmt(t.duration)}</span>
        </button>
        <button class="more-btn" aria-label={translate("More")} onClick={() => setMenu(true)}><Icon name="dots" size={20} /></button>
      </div>
      {menu && <GlassSheet title={t.title} subtitle={t.artist} items={items} onClose={() => setMenu(false)} />}
      {edit && <EditTrack id={t.id} onClose={() => setEdit(false)} />}
    </>
  )
}

function Books() {
  const books = tracks.value.filter(t => t.kind === 'audiobook')
  const [menu, setMenu] = useState<string | null>(null)
  if (!books.length) return <div class="empty">{translate("No audiobooks yet.")}<br />{translate("Files longer than an hour, and .m4b files, are filed here automatically. You can also choose “Audiobook” under Edit info on any song.")}</div>
  return <div class="group">{books.map(t => { const p = positions.value[t.id] ?? 0; const live = bookState.value.trackId === t.id; return (
    <div class="row" style={{ padding: 0 }}>
      <button class={`row${live ? ' active' : ''}`} style={{ flex: 1, minWidth: 0 }} onClick={() => void playBook(t.id)}><Art id={t.id} /><div class="grow"><div class="t">{t.title}</div><div class="s">{t.artist} · {p ? `${Math.round((p / t.duration) * 100)}% · ` : ''}{Math.round(t.duration / 60)}{translate(" min")}</div></div></button>
      <button aria-label={translate("More")} style={{ padding: '0 14px', fontSize: 20, color: 'var(--fg2)' }} onClick={() => setMenu(t.id)}>⋯</button>
      {menu === t.id && <ActionMenu items={[{ label: translate("Mark as music"), run: () => void updateTrack(t.id, { kind: 'music' }) }]} onClose={() => setMenu(null)} />}
    </div>) })}</div>
}

function BookmarkList() {
  const list = [...bookmarks.value].sort((a, b) => b.createdAt - a.createdAt)
  if (!list.length) return <div class="empty">{translate("No bookmarks yet.")}<br />{translate("Add one from the Now Playing screen.")}</div>
  return <div class="group">{list.map(b => { const t = trackById.value.get(b.trackId); return (
    <div class="row" style={{ padding: 0 }}><button class="row" style={{ flex: 1, minWidth: 0 }} onClick={() => void playBookmark(b)}><Art id={b.trackId} /><div class="grow"><div class="t">{b.label}</div><div class="s">{t?.title ?? translate("Deleted song")} · {fmt(b.time)}</div></div></button>
      <button aria-label={translate("Delete bookmark")} style={{ padding: '0 16px', color: 'var(--danger)' }} onClick={() => void removeBookmark(b.id)}>✕</button></div>) })}</div>
}

function Songs({ list, header }: { list: Track[]; header?: boolean }) {
  const [q, setQ] = useState('')
  const [key, setKey] = useState<'title' | 'artist' | 'album' | 'addedAt' | 'duration' | 'playCount'>('title')
  const dq = useDebounced(q, 120)
  const shown = useMemo(() => sortTracks(searchTracks(list, dq), key, key === 'addedAt' || key === 'playCount' ? 'desc' : 'asc'), [list, dq, key])
  if (!list.length) return <div class="empty">{translate("Nothing here yet.")}</div>
  return (
    <>
      <input class="search" type="search" placeholder={translate("Search songs, artists, albums")} value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} />
      <div class="actions">
        <button class="btn small" onClick={() => void playTracks(shown, 0)}>{translate("▶ Play")}</button>
        <button class="btn small secondary" onClick={() => { shuffle.value = true; void playTracks(shown, Math.floor(Math.random() * shown.length)) }}>{translate("⤮ Shuffle")}</button>
        {header !== false && <select aria-label={translate("Sort")} value={key} onChange={e => setKey((e.target as HTMLSelectElement).value as typeof key)} style={{ marginLeft: 'auto', background: 'var(--bg2)', borderRadius: 8, padding: '6px 8px', border: 0 }}>
          <option value="title">{translate("Title")}</option><option value="artist">{translate("Artist")}</option><option value="album">{translate("Album")}</option><option value="addedAt">{translate("Recently added")}</option><option value="duration">{translate("Length")}</option><option value="playCount">{translate("Most played")}</option>
        </select>}
      </div>
      {!shown.length && <div class="empty">{translate('No matches')}</div>}
      <div class="group"><VirtualList items={shown} keyOf={t => t.id} render={(t, i) => <SongRow t={t} list={shown} i={i} />} /></div>
    </>
  )
}

function Groups({ groups, title }: { groups: TrackGroup[]; title: string }) {
  if (!groups.length) return <div class="empty">{translate('No {name} yet.', { name: title.toLowerCase() })}</div>
  return <div class="group"><VirtualList items={groups} keyOf={g => g.key} render={g => (
    <button class="row" style={{ height: '100%' }} onClick={() => push({ kind: 'group', title: g.key, ids: g.tracks.map(t => t.id) })}>
      <Art id={g.tracks[0]?.id} /><div class="grow"><div class="t">{g.key}</div><div class="s">{translate('songCount', { count: g.tracks.length })} · {fmt(g.duration)}</div></div><span class="chev">›</span>
    </button>)} /></div>
}

function PlaylistPage({ id }: { id: string }) {
  const p = playlists.value.find(x => x.id === id)
  if (!p) return <div class="empty">{translate("Playlist deleted.")}</div>
  const list = p.trackIds.map(i => trackById.value.get(i)).filter((t): t is NonNullable<typeof t> => !!t)
  const move = (i: number, d: number) => { const ids = [...p.trackIds]; const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j]!, ids[i]!]; void updatePlaylist(p.id, { trackIds: ids }) }
  return (
    <>
      <div class="actions">
        <button class="btn small" disabled={!list.length} onClick={() => void playTracks(list, 0)}>{translate("▶ Play")}</button>
        <button class="btn small secondary" onClick={() => { const n = prompt(translate("Rename playlist"), p.name); if (n) void updatePlaylist(p.id, { name: n }) }}>{translate("Rename")}</button>
        <button class="btn small danger" onClick={() => { if (confirm(translate("Delete playlist “{name}”?", { name: p.name }))) { void deletePlaylist(p.id); pop() } }}>{translate("Delete")}</button>
      </div>
      {!list.length && <div class="empty">{translate("Add songs from the ⋯ menu in Songs.")}</div>}
      <div class="group">{list.map((t, i) => (
        <div class="row" style={{ padding: 0 }}>
          <button class="row" style={{ flex: 1, minWidth: 0 }} onClick={() => void playTracks(list, i)}><Art id={t.id} /><div class="grow"><div class="t">{t.title}</div><div class="s">{t.artist}</div></div></button>
          <button aria-label={translate("Move up")} style={{ padding: 8 }} onClick={() => move(i, -1)}>↑</button>
          <button aria-label={translate("Move down")} style={{ padding: 8 }} onClick={() => move(i, 1)}>↓</button>
          <button aria-label={translate("Remove")} style={{ padding: '8px 12px', color: 'var(--danger)' }} onClick={() => void updatePlaylist(p.id, { trackIds: p.trackIds.filter(x => x !== t.id) })}>✕</button>
        </div>))}</div>
    </>
  )
}

export function Library() {
  const page = stack.value.at(-1)!
  const everything = tracks.value
  const all = everything.filter(t => t.kind !== 'audiobook')
  let title = translate("Library")
  let body
  switch (page.kind) {
    case 'root':
      body = (
        <>
          <h1 class="large-title">{translate("Library")}</h1>
          <div class="group">{ROOT.map(r => (
            <button class="row" onClick={() => push({ kind: r.kind })}><span class="icon" style={{ background: r.color }}>{r.icon}</span><div class="grow t">{translate(r.label)}</div>
              <span class="s">{r.kind === 'songs' ? all.length : r.kind === 'playlists' ? playlists.value.length : r.kind === 'favorites' ? all.filter(t => t.favorite).length : r.kind === 'audiobooks' ? everything.length - all.length : r.kind === 'bookmarks' ? bookmarks.value.length : ''}</span><span class="chev">›</span></button>))}</div>
          {!all.length && <div class="empty">{translate("Your library is empty.")}<br />{translate("Import music from your iPhone or iCloud Drive.")}<div style={{ marginTop: 16 }}><button class="btn" onClick={() => push({ kind: 'files' })}>{translate("Import music…")}</button></div></div>}
        </>)
      break
    case 'audiobooks': title = translate("Audiobooks"); body = <Books />; break
    case 'files': title = translate('Import & storage'); body = <Files />; break
    case 'bookmarks': title = translate("Bookmarks"); body = <BookmarkList />; break
    case 'songs': title = translate("Songs"); body = <Songs list={all} />; break
    case 'favorites': title = translate("Favorites"); body = <Songs list={all.filter(t => t.favorite)} />; break
    case 'recents': title = translate("Recents"); body = <Songs list={recents(all, 100)} header={false} />; break
    case 'unplayed': title = translate("Unplayed"); body = <Songs list={unplayed(all)} />; break
    case 'albums': title = translate("Albums"); body = <Groups title={translate("Albums")} groups={groupAlbums(all)} />; break
    case 'artists': title = translate("Artists"); body = <Groups title={translate("Artists")} groups={groupArtists(all)} />; break
    case 'genres': title = translate("Genres"); body = <Groups title={translate("Genres")} groups={groupGenres(all)} />; break
    case 'group': title = page.title; body = <Songs list={page.ids.map(i => trackById.value.get(i)).filter((t): t is Track => !!t)} />; break
    case 'playlists':
      title = translate("Playlists")
      body = (
        <>
          <div class="actions"><button class="btn small" onClick={() => { const n = prompt(translate("Playlist name")); if (n) void createPlaylist(n) }}>{translate("＋ New playlist")}</button></div>
          {!playlists.value.length && <div class="empty">{translate("No playlists yet.")}</div>}
          <div class="group">{playlists.value.map(p => (
            <button class="row" onClick={() => push({ kind: 'playlist', id: p.id })}><span class="icon" style={{ background: '#ff453a' }}>☰</span><div class="grow"><div class="t">{p.name}</div><div class="s">{translate('{count} songs', { count: p.trackIds.length })}</div></div><span class="chev">›</span></button>))}</div>
        </>)
      break
    case 'playlist': title = playlists.value.find(p => p.id === page.id)?.name ?? translate("Playlist"); body = <PlaylistPage id={page.id} />; break
  }
  return (
    <>
      {page.kind !== 'root' && <div class="nav"><button class="side" onClick={pop}>{translate("‹ Back")}</button><h1>{title}</h1><span class="side right" /></div>}
      {body}
    </>
  )
}
