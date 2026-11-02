import { useEffect, useMemo, useState } from 'preact/hooks'
import { signal } from '@preact/signals'
import { t as translate } from '../i18n'
import {
  artworkUrl, createPlaylist, deletePlaylistWithUndo, removeFromPlaylistWithUndo, enqueue, engineState, notify, playTracks, playlists, queueIds, setPlaylistArtwork,
  removePlaylistArtwork, settings, shuffle, toggleFavorite, trackById, tracks, updatePlaylist, updateSettings,
} from '../state'
import type { Playlist, StoredTrack } from '../library/store'
import { exportM3U, exportSeamJson, matchEntries, moveItem, parsePlaylistFile, playlistDuration, searchPlaylists, sortPlaylists } from '../library/playlistIO'
import { searchTracks, sortTracks } from '../library/model'
import { Art, fmt, saveBlob, useDebounced, useEdgeSwipeBack, useInView, useSheet } from './common'
import { askConfirm, askText, GlassMenu, GlassSheet, type GlassItem } from './Glass'
import { Icon } from './Icon'
import { EditTrack } from './Edit'
import { useSortable } from './useSortable'
import { VirtualList } from './VirtualList'
import { OverlayPortal } from './overlay'

type View = { kind: 'list' } | { kind: 'detail'; id: string }
const view = signal<View>({ kind: 'list' })
let listScroll = 0
const scroller = () => document.querySelector<HTMLElement>('.view')
const open = (id: string) => { listScroll = scroller()?.scrollTop ?? 0; view.value = { kind: 'detail', id }; scroller()?.scrollTo({ top: 0 }) }
const back = () => { view.value = { kind: 'list' }; requestAnimationFrame(() => scroller()?.scrollTo({ top: listScroll })) }

function durationLabel(sec: number): string {
  if (sec < 60) return translate('secondsCount', { count: Math.round(sec) })
  if (sec < 3600) return translate('minutesCount', { count: Math.round(sec / 60) })
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60)
  return translate('{hours} hr {minutes} min', { hours: h, minutes: m })
}

const listOf = (p: Playlist): StoredTrack[] => p.trackIds.map(i => trackById.value.get(i)).filter((x): x is StoredTrack => !!x)
const durationOf = (p: Playlist) => playlistDuration(p, trackById.value)

function Cover({ p, size }: { p: Playlist; size?: number }) {
  const [host, seen] = useInView<HTMLDivElement>()
  const [urls, setUrls] = useState<{ custom: string | null; arts: string[] }>({ custom: null, arts: [] })
  const key = `${p.id}|${p.updatedAt}|${p.customArt ? 1 : 0}|${p.trackIds.slice(0, 8).join(',')}`
  useEffect(() => {
    if (!seen) return
    let live = true
    void (async () => {
      const custom = p.customArt ? await artworkUrl(`pl:${p.id}`, 'sm') : null
      const arts: string[] = []
      if (!custom) for (const id of p.trackIds.slice(0, 8)) { // stop as soon as a 2x2 collage is possible
        const u = await artworkUrl(id, 'sm')
        if (u && !arts.includes(u)) arts.push(u)
        if (arts.length >= 4 || !live) break
      }
      if (live) setUrls({ custom, arts })
    })()
    return () => { live = false }
  }, [key, seen])
  const style = size ? { width: `${size}px`, height: `${size}px`, borderRadius: '10px', fontSize: '22px' } : undefined
  const { custom, arts } = urls
  if (custom) return <div ref={host} class="cover img" style={{ ...style, backgroundImage: `url(${custom})` }} />
  if (arts.length >= 4) return <div ref={host} class="cover collage" style={style}>{arts.slice(0, 4).map(u => <i style={{ backgroundImage: `url(${u})` }} />)}</div>
  if (arts[0]) return <div ref={host} class="cover img" style={{ ...style, backgroundImage: `url(${arts[0]})` }} />
  return <div ref={host} class="cover" style={style}>♪</div>
}

/** Full-size cover for the detail hero: the custom image, else the first song that has artwork. */
function useHeroCover(p: Playlist | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const key = p ? `${p.id}|${p.updatedAt}|${p.customArt ? 1 : 0}|${p.trackIds.slice(0, 8).join(',')}` : ''
  useEffect(() => {
    if (!p) return
    let live = true
    void (async () => {
      let found: string | null = p.customArt ? await artworkUrl(`pl:${p.id}`, 'full') : null
      if (!found) for (const id of p.trackIds.slice(0, 8)) { found = await artworkUrl(id, 'full'); if (found || !live) break }
      if (live) setUrl(found)
    })()
    return () => { live = false }
  }, [key])
  return url
}

function Thumb({ id }: { id: string }) {
  const [host, seen] = useInView<HTMLSpanElement>()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { if (!seen) return; let live = true; void artworkUrl(id, 'sm').then(u => live && setUrl(u)); return () => { live = false } }, [id, seen])
  return <span ref={host} class="pd-thumb">{url ? <img src={url} alt="" /> : <Icon name="music" size={22} />}</span>
}

const summaryOf = (count: number, sec: number) => `${translate('songCount', { count })}, ${translate('minutesCount', { count: Math.round(sec / 60) })}`

function TrackPicker({ title, onDone, onClose }: { title: string; onDone: (ids: string[]) => void; onClose: () => void }) {
  const { ref } = useSheet(onClose)
  const [pick, setPick] = useState<string[]>([])
  const [q, setQ] = useState('')
  const list = useMemo(() => sortTracks(searchTracks(tracks.value.filter(x => x.kind !== 'audiobook'), q), 'title'), [q, tracks.value])
  return (
    <div class="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
      <div class="nav" style={{ margin: '-12px -24px 8px' }}><button class="side" onClick={onClose}>{translate('Cancel')}</button><h1>{title}</h1><button class="side right" disabled={!pick.length} onClick={() => { onDone(pick); onClose() }}>{translate('Add')} {pick.length || ''}</button></div>
      <input class="search" style={{ margin: '4px 0 8px', width: '100%' }} type="search" placeholder={translate('Search songs, artists, albums')} value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} />
      {!tracks.value.length && <div class="empty">{translate('Import music first: Library › Import & storage.')}</div>}
      <div class="group" style={{ margin: 0 }}><VirtualList items={list} keyOf={x => x.id} render={x => (
        <button class={`row${pick.includes(x.id) ? ' active' : ''}`} style={{ height: '100%' }} onClick={() => setPick(p => (p.includes(x.id) ? p.filter(y => y !== x.id) : [...p, x.id]))}>
          <Art id={x.id} /><div class="grow"><div class="t">{x.title}</div><div class="s">{x.artist} · {fmt(x.duration)}</div></div><span style={{ color: 'var(--accent)' }}>{pick.includes(x.id) ? <Icon name="checkCircle" /> : <Icon name="circle" />}</span>
        </button>)} /></div>
    </div>
  )
}

function HelpSheet({ onClose }: { onClose: () => void }) {
  const { ref } = useSheet(onClose)
  return (
    <div class="sheet" role="dialog" aria-modal="true" aria-label={translate('Help')} ref={ref} tabIndex={-1}>
      <div class="nav" style={{ margin: '-12px -24px 8px' }}><span class="side" /><h1>{translate('Help')}</h1><button class="side right" onClick={onClose}>{translate('Done')}</button></div>
      <ul class="help-list">
        <li>{translate('Tap + to create a playlist or import an .m3u, .m3u8, .pls or SEAM playlist file. Songs are matched to your library by file name, then by artist and title.')}</li>
        <li>{translate('The ••• menu can select several playlists, search, sort, and switch between grid and list.')}</li>
        <li>{translate('Open a playlist to play it, add songs, and rearrange them: choose Rearrange songs, then drag the handles (or hold a row).')}</li>
        <li>{translate('Play next puts the playlist after the current song; Play later adds it to the end of the queue. Crossfade settings apply as usual.')}</li>
        <li>{translate('Archive hides a playlist from the main grid without deleting it. Archived playlists appear at the bottom and can be restored.')}</li>
        <li>{translate('Export saves an .m3u file (for other players) or a SEAM file. Everything is stored on this device.')}</li>
      </ul>
    </div>
  )
}

async function importFile(file: File) {
  try {
    const parsed = parsePlaylistFile(file.name, await file.text())
    const lib = tracks.value
    const { ids, unmatched } = matchEntries(parsed.entries, lib)
    if (!parsed.entries.length) return notify(translate('No songs found in that file'))
    const p = await createPlaylist(parsed.name || file.name.replace(/\.[^.]+$/, ''), ids)
    notify(unmatched.length ? translate('importedSongsMissing', { count: ids.length, missing: unmatched.length }) : translate('importedSongs', { count: ids.length }))
    open(p.id)
  } catch { notify(translate('Could not read that playlist file')) }
}

async function exportPlaylist(p: Playlist, fmtKind: 'm3u' | 'json') {
  const byId = trackById.value
  const body = fmtKind === 'm3u' ? exportM3U(p, byId) : exportSeamJson(p, byId)
  await saveBlob(new Blob([body], { type: fmtKind === 'm3u' ? 'audio/x-mpegurl' : 'application/json' }), `${p.name}.${fmtKind === 'm3u' ? 'm3u8' : 'seam-playlist.json'}`)
}

const newPlaylist = async () => {
  const n = await askText({ title: translate('New playlist'), placeholder: translate('Playlist name'), ok: translate('Create') })
  if (n) { const p = await createPlaylist(n); open(p.id) }
}

function pickFile(accept: string, onFile: (f: File) => void) {
  const i = document.createElement('input'); i.type = 'file'; i.accept = accept
  i.onchange = () => { const f = i.files?.[0]; if (f) onFile(f) }
  i.click()
}

const playAll = (list: StoredTrack[]) => { shuffle.value = false; void playTracks(list, 0) }
const playShuffled = (list: StoredTrack[]) => { if (!list.length) return; shuffle.value = true; void playTracks(list, Math.floor(Math.random() * list.length)) }

const artworkItems = (p: Playlist): GlassItem[] => [
  { label: translate('Choose photo…'), icon: 'image', run: () => pickFile('image/*', f => void setPlaylistArtwork(p.id, f).then(() => notify(translate('Artwork updated'))).catch(() => notify(translate('Could not read that image')))) },
  { label: translate('Use song artwork'), icon: 'restore', disabled: !p.customArt, run: () => void removePlaylistArtwork(p.id) },
]
const renamePlaylist = async (p: Playlist) => { const n = await askText({ title: translate('Rename playlist'), value: p.name, ok: translate('Save') }); if (n) void updatePlaylist(p.id, { name: n }) }
const confirmDelete = async (ps: Playlist[]) => {
  const ok = await askConfirm({ title: ps.length === 1 ? translate('Delete playlist “{name}”?', { name: ps[0]!.name }) : translate('deletePlaylists', { count: ps.length }), message: translate('The songs stay in your library.'), ok: translate('Delete'), danger: true })
  if (ok) deletePlaylistWithUndo(ps)
  return ok
}
const exportItems = (p: Playlist): GlassItem[] => [
  { label: translate('M3U playlist (.m3u8)'), icon: 'export', run: () => void exportPlaylist(p, 'm3u') },
  { label: translate('SEAM playlist (.json)'), icon: 'export', run: () => void exportPlaylist(p, 'json') },
]

// ============================== LIST SCREEN ==============================
function PlaylistList() {
  const s = settings.value
  const [menu, setMenu] = useState<'plus' | 'more' | null>(null)
  const [searching, setSearching] = useState(false)
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 120)
  const [selecting, setSelecting] = useState(false)
  const [sel, setSel] = useState<string[]>([])
  const [help, setHelp] = useState(false)
  const [sheet, setSheet] = useState<Playlist | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const byId = trackById.value
  const all = playlists.value
  const active = useMemo(() => sortPlaylists(searchPlaylists(all.filter(p => !p.archived), dq, byId), s.playlistSortKey, s.playlistSortDir, byId), [all, dq, s.playlistSortKey, s.playlistSortDir, byId])
  const archived = all.filter(p => p.archived)
  const allTracks = useMemo(() => active.flatMap(listOf), [active])
  const exitSelect = () => { setSelecting(false); setSel([]) }
  const toggle = (id: string) => setSel(x => (x.includes(id) ? x.filter(y => y !== id) : [...x, id]))
  const picked = active.filter(p => sel.includes(p.id))

  const sortSub: GlassItem[] = ([['name', translate('Name')], ['created', translate('Date created')], ['updated', translate('Date modified')], ['duration', translate('Duration')], ['count', translate('Number of songs')]] as const)
    .map(([k, label]) => ({ label: s.playlistSortKey === k ? `${label} ${s.playlistSortDir === 'asc' ? '↑' : '↓'}` : label, checked: s.playlistSortKey === k, run: () => void updateSettings(s.playlistSortKey === k ? { playlistSortDir: s.playlistSortDir === 'asc' ? 'desc' : 'asc' } : { playlistSortKey: k, playlistSortDir: k === 'name' ? 'asc' : 'desc' }) }))
  const moreItems: GlassItem[] = [
    { label: translate('Select'), icon: 'checkCircle', run: () => setSelecting(true) },
    { label: translate('New playlist'), icon: 'plus', run: () => void newPlaylist() },
    { label: translate('Import playlist'), icon: 'export', run: () => pickFile('.m3u,.m3u8,.pls,.json,audio/x-mpegurl', f => void importFile(f)) },
    { label: translate('Search'), icon: 'search', run: () => setSearching(true) },
    { label: translate('Sort'), icon: 'sort', sub: sortSub },
    { label: s.playlistView === 'grid' ? translate('List') : translate('Grid'), icon: s.playlistView === 'grid' ? 'list' : 'grid', run: () => void updateSettings({ playlistView: s.playlistView === 'grid' ? 'list' : 'grid' }) },
    { label: translate('Help'), icon: 'help', run: () => setHelp(true) },
  ]
  const plusItems: GlassItem[] = [
    { label: translate('New playlist'), icon: 'plus', run: () => void newPlaylist() },
    { label: translate('Import playlist'), icon: 'export', run: () => pickFile('.m3u,.m3u8,.pls,.json,audio/x-mpegurl', f => void importFile(f)) },
  ]
  const rowItems = (p: Playlist): GlassItem[] => [
    { label: translate('Play'), icon: 'play', run: () => playAll(listOf(p)), disabled: !p.trackIds.length },
    { label: translate('Play next'), icon: 'playNext', run: () => void enqueue(listOf(p), 'next'), disabled: !p.trackIds.length },
    { label: translate('Play later'), icon: 'later', run: () => void enqueue(listOf(p), 'later'), disabled: !p.trackIds.length },
    { label: translate('Rename'), icon: 'rename', run: () => void renamePlaylist(p), divider: true },
    { label: translate('Edit image'), icon: 'image', sub: artworkItems(p) },
    { label: translate('Export list'), icon: 'export', sub: exportItems(p) },
    { label: p.archived ? translate('Restore from archive') : translate('Add to archive'), icon: 'archive', run: () => void updatePlaylist(p.id, { archived: !p.archived }) },
    { label: translate('Delete playlist'), icon: 'trash', danger: true, divider: true, run: () => void confirmDelete([p]) },
  ]
  const card = (p: Playlist, i: number) => {
    const on = sel.includes(p.id)
    const go = () => (selecting ? toggle(p.id) : open(p.id))
    return s.playlistView === 'grid' ? (
      <div class="pl-card" style={{ animationDelay: `${Math.min(i, 6) * 20}ms` }}>
        <button style={{ display: 'block', width: '100%' }} onClick={go} aria-label={p.name}><Cover p={p} /></button>
        {selecting ? <span class={`sel-badge${on ? ' on' : ''}`}><Icon name={on ? 'check' : 'circle'} size={18} /></span> : <button class="pl-more" aria-label={translate('More')} onClick={() => setSheet(p)}><Icon name="dots" size={18} /></button>}
        <div class="name">{p.name}</div><div class="sub">{durationLabel(durationOf(p))}</div>
      </div>
    ) : (
      <div class="row" style={{ padding: 0 }}>
        <button class="row" style={{ flex: 1, minWidth: 0 }} onClick={go}>
          {selecting && <span class={`sel-circle${on ? ' on' : ''}`}><Icon name={on ? 'checkCircle' : 'circle'} /></span>}
          <Cover p={p} size={56} /><div class="grow"><div class="t" style={{ fontWeight: 600 }}>{p.name}</div><div class="s">{translate('songCount', { count: p.trackIds.length })} · {durationLabel(durationOf(p))}</div></div>
        </button>
        {!selecting && <button class="more" style={{ width: 48, height: 48, color: 'var(--fg2)' }} aria-label={translate('More')} onClick={() => setSheet(p)}><Icon name="dots" size={20} /></button>}
      </div>
    )
  }
  return (
    <>
      <div class="pl-nav">
        {selecting ? <button class="circle-btn" aria-label={translate('Cancel')} onClick={exitSelect}><Icon name="chevL" /></button>
          : <div style={{ position: 'relative' }}><button class="circle-btn" aria-label={translate('Add')} onClick={() => setMenu('plus')}><Icon name="plus" /></button></div>}
        <h1>{selecting ? translate('{count} selected', { count: sel.length }) : translate('Playlists')}</h1>
        {selecting ? <button class="circle-btn" aria-label={translate('Select all')} onClick={() => setSel(sel.length === active.length ? [] : active.map(p => p.id))}><Icon name="checkCircle" /></button>
          : <button class="circle-btn" aria-label={translate('More')} onClick={() => setMenu('more')}><Icon name="dots" /></button>}
      </div>
      <div class="ctl-row">
        <button aria-label={translate('Search')} onClick={() => { setSearching(s => !s); setQ('') }}><Icon name="search" /></button>
        <button aria-label={translate('Play all')} disabled={!allTracks.length} onClick={() => playAll(allTracks)}><Icon name="play" fill /></button>
        <button aria-label={translate('Shuffle')} disabled={!allTracks.length} onClick={() => playShuffled(allTracks)}><Icon name="shuffle" /></button>
      </div>
      {searching && <div class="pl-search"><Icon name="search" size={18} /><input autofocus type="search" enterkeyhint="search" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setSearching(false); setQ('') } else if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} placeholder={translate('Search playlists')} value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} /><button aria-label={translate('Cancel')} onClick={() => { setSearching(false); setQ('') }}>✕</button></div>}

      {!all.length && <div class="empty"><div style={{ opacity: .5, marginBottom: 10 }}><Icon name="music" size={56} /></div>{translate('No playlists yet.')}<div style={{ marginTop: 16 }}><button class="btn" onClick={() => void newPlaylist()}>{translate('New playlist')}</button></div></div>}
      {s.playlistView === 'grid' ? <div class="pl-grid">{active.map(card)}</div> : <div class="group pl-list">{active.map(card)}</div>}
      {all.length > 0 && <div class="count-label">{translate('Playlists ({count})', { count: active.length })}</div>}
      {q && !active.length && <div class="empty">{translate('No matches')}</div>}

      {archived.length > 0 && !selecting && (
        <div class="group">
          <button class="row" onClick={() => setShowArchived(v => !v)}><span class="icon" style={{ background: '#8e8e93' }}><Icon name="archive" size={16} /></span><div class="grow t">{translate('Archived ({count})', { count: archived.length })}</div><span class="chev">{showArchived ? '⌄' : '›'}</span></button>
          {showArchived && archived.map(p => (
            <div class="row" style={{ padding: 0 }}><button class="row" style={{ flex: 1, minWidth: 0 }} onClick={() => open(p.id)}><Cover p={p} size={44} /><div class="grow"><div class="t">{p.name}</div><div class="s">{translate('songCount', { count: p.trackIds.length })}</div></div></button>
              <button class="more" style={{ width: 48, height: 48, color: 'var(--accent)' }} aria-label={translate('Restore from archive')} onClick={() => void updatePlaylist(p.id, { archived: false })}><Icon name="restore" /></button></div>))}
        </div>)}

      {selecting && (
        <div class="action-bar" role="toolbar">
          <button disabled={!picked.length} onClick={() => playAll(picked.flatMap(listOf))}><Icon name="play" fill /><span>{translate('Play')}</span></button>
          <button disabled={!picked.length} onClick={() => void enqueue(picked.flatMap(listOf), 'next')}><Icon name="playNext" /><span>{translate('Play next')}</span></button>
          <button disabled={!picked.length} onClick={() => { for (const p of picked) void updatePlaylist(p.id, { archived: true }); exitSelect() }}><Icon name="archive" /><span>{translate('Archive')}</span></button>
          <button class="danger" disabled={!picked.length} onClick={async () => { if (await confirmDelete(picked)) exitSelect() }}><Icon name="trash" /><span>{translate('Delete')}</span></button>
        </div>)}

      {menu === 'plus' && <GlassMenu items={plusItems} anchor="left" onClose={() => setMenu(null)} />}
      {menu === 'more' && <GlassMenu items={moreItems} anchor="right" onClose={() => setMenu(null)} />}
      {sheet && <GlassSheet title={sheet.name} subtitle={durationLabel(durationOf(sheet))} items={rowItems(sheet)} onClose={() => setSheet(null)} />}
      {help && <OverlayPortal><HelpSheet onClose={() => setHelp(false)} /></OverlayPortal>}
    </>
  )
}

// ============================== DETAIL SCREEN ==============================
type SongSort = 'manual' | 'title' | 'artist' | 'album' | 'duration' | 'addedAt'

function PlaylistDetail({ id }: { id: string }) {
  const p = playlists.value.find(x => x.id === id)
  const [menu, setMenu] = useState(false)
  const [searching, setSearching] = useState(false)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SongSort>('manual')
  const [grid, setGrid] = useState(false)
  const [rearrange, setRearrange] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [sel, setSel] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [rowSheet, setRowSheet] = useState<StoredTrack | null>(null)
  const [edit, setEdit] = useState<string | null>(null)
  const [share, setShare] = useState(false)
  const cover = useHeroCover(p)
  const cur = queueIds.value[engineState.value.index]

  const all = p ? listOf(p) : []
  const shown = useMemo(() => {
    let l = q ? searchTracks(all, q) : all
    if (sort !== 'manual') l = sortTracks(l, sort, sort === 'addedAt' ? 'desc' : 'asc')
    return l
  }, [p?.trackIds.join(','), q, sort, tracks.value])
  const manual = sort === 'manual' && !q
  const sortable = useSortable({ count: shown.length, handleSelector: '.handle', onMove: (from, to) => { if (p && manual) void updatePlaylist(p.id, { trackIds: moveItem(p.trackIds, from, to) }) } })
  useEffect(() => { if (!rearrange) return; setSort('manual'); setQ(''); setSearching(false); setGrid(false) }, [rearrange])
  useEffect(() => { const r = document.documentElement; r.classList.add('pd-on'); return () => r.classList.remove('pd-on') }, [])
  if (!p) return <div class="empty">{translate('Playlist deleted.')}</div>

  const pick = (x: StoredTrack) => setSel(s => (s.includes(x.id) ? s.filter(y => y !== x.id) : [...s, x.id]))
  const exitSelect = () => { setSelecting(false); setSel([]) }
  const chosen = all.filter(x => sel.includes(x.id))
  const sortSub: GlassItem[] = ([['manual', translate('Playlist order')], ['title', translate('Title')], ['artist', translate('Artist')], ['album', translate('Album')], ['duration', translate('Duration')], ['addedAt', translate('Date added')]] as const).map(([k, label]) => ({ label, checked: sort === k, run: () => setSort(k) }))
  const items: GlassItem[] = [
    { label: translate('Select'), icon: 'checkCircle', run: () => setSelecting(true), disabled: !all.length },
    { label: translate('Play next'), icon: 'playNext', run: () => void enqueue(all, 'next'), disabled: !all.length },
    { label: translate('Play later'), icon: 'later', run: () => void enqueue(all, 'later'), disabled: !all.length },
    { label: translate('Add songs'), icon: 'addSong', run: () => setAdding(true) },
    { label: translate('Rearrange songs'), icon: 'rearrange', run: () => setRearrange(true), disabled: all.length < 2 },
    { label: translate('Rename'), icon: 'rename', run: () => void renamePlaylist(p) },
    { label: translate('Edit image'), icon: 'image', sub: artworkItems(p) },
    { label: translate('Export list'), icon: 'export', sub: exportItems(p) },
    { label: translate('Add to archive'), icon: 'archive', run: () => { void updatePlaylist(p.id, { archived: true }); notify(translate('Archived “{name}”', { name: p.name })); back() } },
    { label: translate('Search'), icon: 'search', run: () => setSearching(true) },
    { label: translate('Sort'), icon: 'sort', sub: sortSub },
    { label: grid ? translate('List') : translate('Grid'), icon: grid ? 'list' : 'grid', run: () => setGrid(g => !g) },
    { label: translate('Delete playlist'), icon: 'trash', danger: true, divider: true, run: async () => { if (await confirmDelete([p])) back() } },
  ]
  const remove = (ids: string[]) => removeFromPlaylistWithUndo(p.id, ids)
  const songItems = (x: StoredTrack): GlassItem[] => [
    { label: translate('Play'), icon: 'play', run: () => void playTracks(manual ? all : shown, (manual ? all : shown).indexOf(x)) },
    { label: translate('Play next'), icon: 'playNext', run: () => void enqueue([x], 'next') },
    { label: translate('Play later'), icon: 'later', run: () => void enqueue([x], 'later') },
    { label: translate('Add to playlist'), icon: 'addSong', sub: [
      { label: translate('New playlist'), icon: 'plus', run: async () => { const n = await askText({ title: translate('New playlist'), placeholder: translate('Playlist name'), ok: translate('Create') }); if (n) void createPlaylist(n, [x.id]) } },
      ...playlists.value.filter(o => o.id !== p.id && !o.archived).map(o => ({ label: o.name, icon: 'music' as const, run: () => { if (!o.trackIds.includes(x.id)) void updatePlaylist(o.id, { trackIds: [...o.trackIds, x.id] }); notify(translate('Added to {name}', { name: o.name })) } })),
    ] },
    { label: x.favorite ? translate('Remove from favorites') : translate('Add to favorites'), icon: 'heart', run: () => void toggleFavorite(x.id) },
    { label: translate('Edit info…'), icon: 'edit', run: () => setEdit(x.id) },
    { label: translate('Remove from playlist'), icon: 'minus', danger: true, divider: true, run: () => remove([x.id]) },
  ]
  const rowFor = (x: StoredTrack, i: number) => {
    const on = sel.includes(x.id)
    const playHere = () => (selecting ? pick(x) : void playTracks(shown, i))
    const props = rearrange && manual ? sortable.itemProps(i) : {}
    return (
      <div key={x.id} {...(props as object)} class={`song-row${selecting ? ' selecting' : ''}${cur === x.id ? ' active' : ''}${sortable.draggingIndex === i && rearrange ? ' dragging' : ''}`}>
        {selecting && <span class={`sel-circle${on ? ' on' : ''}`}><Icon name={on ? 'checkCircle' : 'circle'} /></span>}
        <button class="main" onClick={playHere}>
          <Thumb id={x.id} />
          <span class="pd-text"><span class="st">{x.title}</span><span class="ss">{fmt(x.duration)}</span></span>
        </button>
        {rearrange && manual ? <span class="handle" aria-label={translate('Reorder {title}', { title: x.title })} role="button" tabIndex={0}><Icon name="list" /></span>
          : !selecting && <button class="more" aria-label={translate('More options for {title}', { title: x.title })} onClick={() => setRowSheet(x)}><Icon name="dots" size={20} /></button>}
      </div>
    )
  }
  const mode = rearrange ? translate('Rearrange songs') : selecting ? translate('{count} selected', { count: sel.length }) : ''
  return (
    <div class="pd">
      <div class="pd-nav">
        <div class="pd-nav-inner">
          <button class="pd-glass pd-circle" aria-label={translate('Back')} onClick={() => { if (rearrange) setRearrange(false); else if (selecting) exitSelect(); else back() }}><Icon name="chevL" size={24} /></button>
          {mode && <span class="pd-glass pd-mode">{mode}</span>}
          {rearrange ? <button class="pd-glass pd-circle on" aria-label={translate('Done')} onClick={() => setRearrange(false)}><Icon name="check" /></button>
            : selecting ? <button class="pd-glass pd-circle" aria-label={translate('Select all')} onClick={() => setSel(sel.length === all.length ? [] : all.map(x => x.id))}><Icon name="checkCircle" /></button>
            : <div class="pd-glass pd-pill">
              <button aria-label={translate('Share')} onClick={() => setShare(true)}><Icon name="export" /></button>
              <button aria-label={translate('More')} onClick={() => setMenu(true)}><Icon name="dots" /></button>
            </div>}
        </div>
      </div>
      <header class="pd-hero">
        {cover ? <img class="pd-hero-img" src={cover} alt="" /> : <div class="pd-hero-fallback" />}
        <div class="pd-hero-fade" aria-hidden="true" />
      </header>
      <div class="pd-title"><h1>{p.name}</h1><div class="pd-kind">{translate('Playlist')}</div></div>
      <div class="pd-actions">
        <button class="pd-round" aria-label={translate('Shuffle')} disabled={!shown.length} onClick={() => playShuffled(shown)}><Icon name="shuffle" size={21} /></button>
        <button class="pd-play" aria-label={translate('Play all')} disabled={!shown.length} onClick={() => playAll(shown)}><Icon name="play" size={17} fill />{translate('Play')}</button>
        <button class="pd-round" aria-label={translate('Search this playlist')} aria-pressed={searching} onClick={() => { setSearching(s => !s); setQ('') }}><Icon name="search" size={21} /></button>
      </div>
      {searching && <div class="pl-search"><Icon name="search" size={18} /><input autofocus type="search" enterkeyhint="search" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setSearching(false); setQ('') } else if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} placeholder={translate('Search this playlist')} value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} /><button aria-label={translate('Cancel')} onClick={() => { setSearching(false); setQ('') }}>✕</button></div>}
      {sort !== 'manual' && <div class="hint" style={{ margin: '0 16px 8px' }}>{translate('Sorted view — choose Sort › Playlist order to rearrange.')}</div>}
      {!all.length && <div class="empty">{translate('This playlist is empty.')}<div style={{ marginTop: 16 }}><button class="btn" onClick={() => setAdding(true)}>{translate('Add songs')}</button></div></div>}
      {grid ? <div class="pd-list pl-grid">{shown.map((x, i) => (
        <div class="pl-card"><button style={{ display: 'block', width: '100%' }} onClick={() => (selecting ? pick(x) : void playTracks(shown, i))}><div class="cover img" style={{}}><Art id={x.id} big /></div></button>
          {selecting && <span class={`sel-badge${sel.includes(x.id) ? ' on' : ''}`}><Icon name={sel.includes(x.id) ? 'check' : 'circle'} size={18} /></span>}
          <div class="name">{x.title}</div><div class="sub">{x.artist}</div></div>))}</div>
        : <div class="pd-list" {...((rearrange && manual ? sortable.containerProps : {}) as object)}>{shown.map(rowFor)}</div>}
      {q && !shown.length && <div class="empty">{translate('No matches')}</div>}
      {all.length > 0 && <p class="pd-summary">{summaryOf(all.length, durationOf(p))}</p>}

      {selecting && (
        <div class="action-bar" role="toolbar">
          <button disabled={!chosen.length} onClick={() => { playAll(chosen); exitSelect() }}><Icon name="play" fill /><span>{translate('Play')}</span></button>
          <button disabled={!chosen.length} onClick={() => { void enqueue(chosen, 'next'); exitSelect() }}><Icon name="playNext" /><span>{translate('Play next')}</span></button>
          <button disabled={!chosen.length} onClick={() => { void enqueue(chosen, 'later'); exitSelect() }}><Icon name="later" /><span>{translate('Play later')}</span></button>
          <button class="danger" disabled={!chosen.length} onClick={() => { remove(sel); exitSelect() }}><Icon name="minus" /><span>{translate('Remove')}</span></button>
        </div>)}

      {menu && <GlassMenu items={items} anchor="right" onClose={() => setMenu(false)} />}
      {share && <GlassMenu items={exportItems(p)} anchor="right" onClose={() => setShare(false)} />}
      {rowSheet && <GlassSheet title={rowSheet.title} subtitle={rowSheet.artist} items={songItems(rowSheet)} onClose={() => setRowSheet(null)} />}
      {adding && <OverlayPortal><TrackPicker title={translate('Add songs')} onDone={ids => { const added = ids.filter(i => !p.trackIds.includes(i)); void updatePlaylist(p.id, { trackIds: [...p.trackIds, ...added] }); notify(translate('addedSongs', { count: added.length })) }} onClose={() => setAdding(false)} /></OverlayPortal>}
      {edit && <OverlayPortal><EditTrack id={edit} onClose={() => setEdit(null)} /></OverlayPortal>}
    </div>
  )
}

export function Playlists() {
  const v = view.value
  useEdgeSwipeBack(v.kind === 'detail' ? back : null)
  // a deleted playlist must not leave the user on a dead screen
  useEffect(() => { if (v.kind === 'detail' && !playlists.value.some(p => p.id === v.id)) back() }, [playlists.value.length])
  return <div key={v.kind === 'detail' ? v.id : 'list'} class="playlist-page">{v.kind === 'list' ? <PlaylistList /> : <PlaylistDetail id={v.id} />}</div>
}
