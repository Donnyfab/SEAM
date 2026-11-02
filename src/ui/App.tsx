import { useEffect, useState } from 'preact/hooks'
import { ready, toast, engineState, queueIds, bookState, settings } from '../state'
import { LockScreen, initLock, locked } from './Security'
import { loadLastFm } from '../connect/scrobbler'
import { Library } from './Library'
import { Files } from './Files'
import { Settings } from './Settings'
import { Studio } from './Studio'
import { Connect } from './Connect'
import { MiniPlayer, NowPlaying } from './Player'
import { BookSheet, MiniBook } from './Book'

type Tab = 'library' | 'studio' | 'connect' | 'files' | 'settings'
const icons: Record<Tab, string> = {
  library: 'M9 18V5l10-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm10-2a3 3 0 11-6 0 3 3 0 016 0z',
  studio: 'M3 12h2m3-6v12m4-9v6m4-10v14m4-9h2',
  connect: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
  files: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zm8-3l-2-.6a6 6 0 00-.5-1.2l1-1.8-1.4-1.4-1.8 1a6 6 0 00-1.2-.5L13.5 4h-3l-.6 2.5a6 6 0 00-1.2.5l-1.8-1L5.5 7.4l1 1.8a6 6 0 00-.5 1.2L4 12v0l2 .6a6 6 0 00.5 1.2l-1 1.8 1.4 1.4 1.8-1a6 6 0 001.2.5l.6 2.5h3l.6-2.5a6 6 0 001.2-.5l1.8 1 1.4-1.4-1-1.8a6 6 0 00.5-1.2L20 12z',
}
const labels: Record<Tab, string> = { library: 'Library', studio: 'Studio', connect: 'Connect', files: 'Files', settings: 'Settings' }

export function App() {
  const [tab, setTab] = useState<Tab>('library')
  const [open, setOpen] = useState(false)
  useEffect(() => { void initLock(); void loadLastFm() }, [])
  useEffect(() => {
    const r = document.documentElement, st = settings.value
    r.style.fontSize = `${17 * st.textScale}px`
    r.classList.toggle('reduce-motion', st.reduceMotion); r.classList.toggle('high-contrast', st.highContrast)
  }, [settings.value.textScale, settings.value.reduceMotion, settings.value.highContrast])
  const bookActive = bookState.value.status !== 'idle' && !!bookState.value.trackId
  const hasTrack = bookActive || (engineState.value.index >= 0 && !!queueIds.value[engineState.value.index])
  return (
    <div class="app">
      <main class={`view${hasTrack ? '' : ' no-mini'}`}>
        {!ready.value ? <div class="empty">Loading…</div> : tab === 'library' ? <Library /> : tab === 'studio' ? <Studio /> : tab === 'connect' ? <Connect /> : tab === 'files' ? <Files /> : <Settings />}
      </main>
      {hasTrack && (bookActive ? <MiniBook onOpen={() => setOpen(true)} /> : <MiniPlayer onOpen={() => setOpen(true)} />)}
      <nav class="tabbar" aria-label="Main">
        {(Object.keys(icons) as Tab[]).map(t => (
          <button class={tab === t ? 'on' : ''} onClick={() => setTab(t)} aria-label={labels[t]} aria-current={tab === t ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={icons[t]} /></svg>{labels[t]}
          </button>))}
      </nav>
      {open && (bookActive ? <BookSheet onClose={() => setOpen(false)} /> : <NowPlaying onClose={() => setOpen(false)} />)}
      {locked.value && <LockScreen />}
      {toast.value && <div class="toast" role="status">{toast.value}</div>}
    </div>
  )
}
