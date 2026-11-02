import { useMemo, useState } from 'preact/hooks'
import { signal } from '@preact/signals'
import { createPlaylist, deletePlaylist, engineState, playTracks, playlists, queueIds, removeTrack, toggleFavorite, tracks, trackById, updatePlaylist, notify, shuffle } from '../state'
import { groupAlbums, groupArtists, groupGenres, recents, searchTracks, sortTracks, unplayed, type Track, type TrackGroup } from '../library/model'
import { ActionMenu, Art, fmt, type MenuItem } from './common'

type Page = { kind: 'root' } | { kind: 'songs' | 'favorites' | 'recents' | 'unplayed' | 'albums' | 'artists' | 'genres' | 'playlists' } | { kind: 'group'; title: string; ids: string[] } | { kind: 'playlist'; id: string }
const stack = signal<Page[]>([{ kind: 'root' }])
const push = (p: Page) => { stack.value = [...stack.value, p] }
const pop = () => { if (stack.value.length > 1) stack.value = stack.value.slice(0, -1) }

const ROOT: { kind: Exclude<Page['kind'], 'root' | 'group' | 'playlist'>; label: string; icon: string; color: string }[] = [
  { kind: 'favorites', label: 'Favorites', icon: '♥', color: '#ff375f' }, { kind: 'recents', label: 'Recents', icon: '◷', color: '#0a84ff' },
  { kind: 'songs', label: 'Songs', icon: '♪', color: '#ff9f0a' }, { kind: 'unplayed', label: 'Unplayed', icon: '✦', color: '#30d158' },
  { kind: 'albums', label: 'Albums', icon: '▤', color: '#5e5ce6' }, { kind: 'artists', label: 'Artists', icon: '☺', color: '#bf5af2' },
  { kind: 'genres', label: 'Genres', icon: '♬', color: '#64d2ff' }, { kind: 'playlists', label: 'Playlists', icon: '☰', color: '#ff453a' },
]

function SongRow({ t, list, i }: { t: Track; list: Track[]; i: number }) {
  const [menu, setMenu] = useState(false)
  const cur = queueIds.value[engineState.value.index] === t.id
  const items: MenuItem[] = [
    { label: 'Play next in queue', run: () => notify('Use Play to start a queue') },
    { label: t.favorite ? 'Remove from favorites' : 'Add to favorites', run: () => void toggleFavorite(t.id) },
    ...playlists.value.map(p => ({ label: `Add to “${p.name}”`, run: () => { if (!p.trackIds.includes(t.id)) void updatePlaylist(p.id, { trackIds: [...p.trackIds, t.id] }); notify(`Added to ${p.name}`) } })),
    { label: 'New playlist with this song…', run: () => { const n = prompt('Playlist name'); if (n) void createPlaylist(n, [t.id]) } },
    { label: 'Delete from library', danger: true, run: () => { if (confirm(`Delete “${t.title}” from this device?`)) void removeTrack(t.id) } },
  ].filter(x => x.label !== 'Play next in queue')
  return (
    <>
      <div class={`row${cur ? ' active' : ''}`} style={{ padding: 0 }}>
        <button class="row" style={{ flex: 1, minWidth: 0 }} onClick={() => void playTracks(list, i)}>
          <Art id={t.id} />
          <div class="grow"><div class="t">{t.favorite ? '♥ ' : ''}{t.title}</div><div class="s">{t.artist} · {t.album}</div></div>
          <span class="s num">{fmt(t.duration)}</span>
        </button>
        <button aria-label="More" style={{ padding: '0 14px', fontSize: 20, color: 'var(--fg2)' }} onClick={() => setMenu(true)}>⋯</button>
      </div>
      {menu && <ActionMenu items={items} onClose={() => setMenu(false)} />}
    </>
  )
}

function Songs({ list, header }: { list: Track[]; header?: boolean }) {
  const [q, setQ] = useState('')
  const [key, setKey] = useState<'title' | 'artist' | 'album' | 'addedAt' | 'duration' | 'playCount'>('title')
  const shown = useMemo(() => sortTracks(searchTracks(list, q), key, key === 'addedAt' || key === 'playCount' ? 'desc' : 'asc'), [list, q, key])
  if (!list.length) return <div class="empty">Nothing here yet.</div>
  return (
    <>
      <input class="search" type="search" placeholder="Search songs, artists, albums" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} />
      <div class="actions">
        <button class="btn small" onClick={() => void playTracks(shown, 0)}>▶ Play</button>
        <button class="btn small secondary" onClick={() => { shuffle.value = true; void playTracks(shown, Math.floor(Math.random() * shown.length)) }}>⤮ Shuffle</button>
        {header !== false && <select aria-label="Sort" value={key} onChange={e => setKey((e.target as HTMLSelectElement).value as typeof key)} style={{ marginLeft: 'auto', background: 'var(--bg2)', borderRadius: 8, padding: '6px 8px', border: 0 }}>
          <option value="title">Title</option><option value="artist">Artist</option><option value="album">Album</option><option value="addedAt">Recently added</option><option value="duration">Length</option><option value="playCount">Most played</option>
        </select>}
      </div>
      <div class="group">{shown.map((t, i) => <SongRow key={t.id} t={t} list={shown} i={i} />)}</div>
    </>
  )
}

function Groups({ groups, title }: { groups: TrackGroup[]; title: string }) {
  if (!groups.length) return <div class="empty">No {title.toLowerCase()} yet.</div>
  return <div class="group">{groups.map(g => (
    <button class="row" onClick={() => push({ kind: 'group', title: g.key, ids: g.tracks.map(t => t.id) })}>
      <Art id={g.tracks[0]?.id} /><div class="grow"><div class="t">{g.key}</div><div class="s">{g.tracks.length} song{g.tracks.length === 1 ? '' : 's'} · {fmt(g.duration)}</div></div><span class="chev">›</span>
    </button>))}</div>
}

function PlaylistPage({ id }: { id: string }) {
  const p = playlists.value.find(x => x.id === id)
  if (!p) return <div class="empty">Playlist deleted.</div>
  const list = p.trackIds.map(i => trackById.value.get(i)).filter((t): t is NonNullable<typeof t> => !!t)
  const move = (i: number, d: number) => { const ids = [...p.trackIds]; const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j]!, ids[i]!]; void updatePlaylist(p.id, { trackIds: ids }) }
  return (
    <>
      <div class="actions">
        <button class="btn small" disabled={!list.length} onClick={() => void playTracks(list, 0)}>▶ Play</button>
        <button class="btn small secondary" onClick={() => { const n = prompt('Rename playlist', p.name); if (n) void updatePlaylist(p.id, { name: n }) }}>Rename</button>
        <button class="btn small danger" onClick={() => { if (confirm(`Delete playlist “${p.name}”?`)) { void deletePlaylist(p.id); pop() } }}>Delete</button>
      </div>
      {!list.length && <div class="empty">Add songs from the ⋯ menu in Songs.</div>}
      <div class="group">{list.map((t, i) => (
        <div class="row" style={{ padding: 0 }}>
          <button class="row" style={{ flex: 1, minWidth: 0 }} onClick={() => void playTracks(list, i)}><Art id={t.id} /><div class="grow"><div class="t">{t.title}</div><div class="s">{t.artist}</div></div></button>
          <button aria-label="Move up" style={{ padding: 8 }} onClick={() => move(i, -1)}>↑</button>
          <button aria-label="Move down" style={{ padding: 8 }} onClick={() => move(i, 1)}>↓</button>
          <button aria-label="Remove" style={{ padding: '8px 12px', color: 'var(--danger)' }} onClick={() => void updatePlaylist(p.id, { trackIds: p.trackIds.filter(x => x !== t.id) })}>✕</button>
        </div>))}</div>
    </>
  )
}

export function Library() {
  const page = stack.value.at(-1)!
  const all = tracks.value
  let title = 'Library'
  let body
  switch (page.kind) {
    case 'root':
      body = (
        <>
          <div class="large-title">Library</div>
          <div class="group">{ROOT.map(r => (
            <button class="row" onClick={() => push({ kind: r.kind })}><span class="icon" style={{ background: r.color }}>{r.icon}</span><div class="grow t">{r.label}</div>
              <span class="s">{r.kind === 'songs' ? all.length : r.kind === 'playlists' ? playlists.value.length : r.kind === 'favorites' ? all.filter(t => t.favorite).length : ''}</span><span class="chev">›</span></button>))}</div>
          {!all.length && <div class="empty">Your library is empty.<br />Go to Files to import music from your iPhone or iCloud Drive.</div>}
        </>)
      break
    case 'songs': title = 'Songs'; body = <Songs list={all} />; break
    case 'favorites': title = 'Favorites'; body = <Songs list={all.filter(t => t.favorite)} />; break
    case 'recents': title = 'Recents'; body = <Songs list={recents(all, 100)} header={false} />; break
    case 'unplayed': title = 'Unplayed'; body = <Songs list={unplayed(all)} />; break
    case 'albums': title = 'Albums'; body = <Groups title="Albums" groups={groupAlbums(all)} />; break
    case 'artists': title = 'Artists'; body = <Groups title="Artists" groups={groupArtists(all)} />; break
    case 'genres': title = 'Genres'; body = <Groups title="Genres" groups={groupGenres(all)} />; break
    case 'group': title = page.title; body = <Songs list={page.ids.map(i => trackById.value.get(i)).filter((t): t is Track => !!t)} />; break
    case 'playlists':
      title = 'Playlists'
      body = (
        <>
          <div class="actions"><button class="btn small" onClick={() => { const n = prompt('Playlist name'); if (n) void createPlaylist(n) }}>＋ New playlist</button></div>
          {!playlists.value.length && <div class="empty">No playlists yet.</div>}
          <div class="group">{playlists.value.map(p => (
            <button class="row" onClick={() => push({ kind: 'playlist', id: p.id })}><span class="icon" style={{ background: '#ff453a' }}>☰</span><div class="grow"><div class="t">{p.name}</div><div class="s">{p.trackIds.length} songs</div></div><span class="chev">›</span></button>))}</div>
        </>)
      break
    case 'playlist': title = playlists.value.find(p => p.id === page.id)?.name ?? 'Playlist'; body = <PlaylistPage id={page.id} />; break
  }
  return (
    <>
      {page.kind !== 'root' && <div class="nav"><button class="side" onClick={pop}>‹ Back</button><h1>{title}</h1><span class="side right" /></div>}
      {body}
    </>
  )
}
