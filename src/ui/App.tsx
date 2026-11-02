import { resolveLocale, setLocale, t as translate } from '../i18n'
import { useEffect, useLayoutEffect, useState } from 'preact/hooks'
import { ready, toast, engineState, queueIds, bookState, settings } from '../state'
import { LockScreen, initLock, locked } from './Security'
import { loadLastFm } from '../connect/scrobbler'
import { Library } from './Library'
import { Playlists } from './Playlists'
import { DialogHost } from './Glass'
import { Settings } from './Settings'
import { Studio } from './Studio'
import { Connect } from './Connect'
import { MiniPlayer, NowPlaying } from './Player'
import { BookSheet, MiniBook } from './Book'

type Tab = 'playlists' | 'library' | 'studio' | 'connect' | 'settings'
const icons: Record<Tab, string> = {
  playlists: 'M4 6h12M4 11h12M4 16h7M19 4v11M19 15a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z',
  library: 'M9 18V5l10-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm10-2a3 3 0 11-6 0 3 3 0 016 0z',
  studio: 'M3 12h2m3-6v12m4-9v6m4-10v14m4-9h2',
  connect: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zm8-3l-2-.6a6 6 0 00-.5-1.2l1-1.8-1.4-1.4-1.8 1a6 6 0 00-1.2-.5L13.5 4h-3l-.6 2.5a6 6 0 00-1.2.5l-1.8-1L5.5 7.4l1 1.8a6 6 0 00-.5 1.2L4 12v0l2 .6a6 6 0 00.5 1.2l-1 1.8 1.4 1.4 1.8-1a6 6 0 001.2.5l.6 2.5h3l.6-2.5a6 6 0 001.2-.5l1.8 1 1.4-1.4-1-1.8a6 6 0 00.5-1.2L20 12z',
}
const labels: Record<Tab, string> = { playlists: 'Playlists', library: 'Library', studio: 'Studio', connect: 'Connect', settings: 'Settings' }

export function App() {
  const [tab, setTab] = useState<Tab>('playlists')
  const [open, setOpen] = useState(false)
  useEffect(() => { void initLock(); void loadLastFm() }, [])
  useEffect(() => {
    const r = document.documentElement, st = settings.value
    r.style.fontSize = `${17 * st.textScale}px`
    r.classList.toggle('reduce-motion', st.reduceMotion); r.classList.toggle('high-contrast', st.highContrast)
  }, [settings.value.textScale, settings.value.reduceMotion, settings.value.highContrast])
  useLayoutEffect(() => {
    const applyLanguage = () => {
      const code = resolveLocale(settings.value.language, navigator.languages)
      setLocale(code); document.documentElement.lang = code
    }
    applyLanguage()
    window.addEventListener('languagechange', applyLanguage)
    return () => window.removeEventListener('languagechange', applyLanguage)
  }, [settings.value.language])
  const bookActive = bookState.value.status !== 'idle' && !!bookState.value.trackId
  const hasTrack = bookActive || (engineState.value.index >= 0 && !!queueIds.value[engineState.value.index])
  return (
    <div class="app">
      <main class={`view${hasTrack ? '' : ' no-mini'}`}>
        {!ready.value ? <div class="empty">{translate("Loading…")}</div> : tab === 'playlists' ? <Playlists /> : tab === 'library' ? <Library /> : tab === 'studio' ? <Studio /> : tab === 'connect' ? <Connect /> : <Settings />}
      </main>
      {hasTrack && (bookActive ? <MiniBook onOpen={() => setOpen(true)} /> : <MiniPlayer onOpen={() => setOpen(true)} />)}
      <nav class="tabbar" aria-label={translate("Main")}>
        {(Object.keys(icons) as Tab[]).map(t => (
          <button class={tab === t ? 'on' : ''} onClick={() => setTab(t)} aria-label={translate(labels[t])} aria-current={tab === t ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={icons[t]} /></svg>{translate(labels[t])}
          </button>))}
      </nav>
      {open && (bookActive ? <BookSheet onClose={() => setOpen(false)} /> : <NowPlaying onClose={() => setOpen(false)} />)}
      <DialogHost />
      {locked.value && <LockScreen />}
      {toast.value && <div class="toast" role="status">{toast.value}</div>}
    </div>
  )
}
