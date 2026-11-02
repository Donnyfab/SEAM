import { resolveLocale, setLocaleAsync, t as translate } from '../i18n'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { signal } from '@preact/signals'
import { ready, toast, undoToast, notify, engineState, queueIds, bookState, settings } from '../state'
import { LockScreen, initLock, locked } from './Security'
import { Playlists } from './Playlists'
import { DialogHost } from './Glass'
import { MiniPlayer, NowPlaying } from './Player'
import { MiniBook } from './Book'
import { Boundary, ScreenSkeleton, lazyScreen } from './lazy'

const Library = lazyScreen(() => import('./Library'), 'Library')
const Studio = lazyScreen(() => import('./Studio'), 'Studio')
const Connect = lazyScreen(() => import('./Connect'), 'Connect')
const Settings = lazyScreen(() => import('./Settings'), 'Settings')
const BookSheet = lazyScreen<{ onClose: () => void }>(() => import('./Book'), 'BookSheet')

type Tab = 'playlists' | 'library' | 'studio' | 'connect' | 'settings'
const TABS: Tab[] = ['playlists', 'library', 'studio', 'connect', 'settings']
const icons: Record<Tab, string> = {
  playlists: 'M4 6h12M4 11h12M4 16h7M19 4v11M19 15a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z',
  library: 'M9 18V5l10-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm10-2a3 3 0 11-6 0 3 3 0 016 0z',
  studio: 'M3 12h2m3-6v12m4-9v6m4-10v14m4-9h2',
  connect: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zm8-3l-2-.6a6 6 0 00-.5-1.2l1-1.8-1.4-1.4-1.8 1a6 6 0 00-1.2-.5L13.5 4h-3l-.6 2.5a6 6 0 00-1.2.5l-1.8-1L5.5 7.4l1 1.8a6 6 0 00-.5 1.2L4 12v0l2 .6a6 6 0 00.5 1.2l-1 1.8 1.4 1.4 1.8-1a6 6 0 001.2.5l.6 2.5h3l.6-2.5a6 6 0 001.2-.5l1.8 1 1.4-1.4-1-1.8a6 6 0 00.5-1.2L20 12z',
}
const labels: Record<Tab, string> = { playlists: 'Playlists', library: 'Library', studio: 'Studio', connect: 'Connect', settings: 'Settings' }

const online = signal(navigator.onLine)
const readTab = (): Tab => { try { const t = localStorage.getItem('seam:tab') as Tab | null; return t && TABS.includes(t) ? t : 'playlists' } catch { return 'playlists' } }
const scrollMemory = new Map<Tab, number>()

export function App() {
  const [tab, setTabState] = useState<Tab>(readTab)
  const [open, setOpen] = useState(false)
  const view = useRef<HTMLElement>(null)

  const setTab = (next: Tab) => {
    if (next === tab) { view.current?.scrollTo({ top: 0, behavior: 'smooth' }); return } // tapping the active tab scrolls to top, like iOS
    scrollMemory.set(tab, view.current?.scrollTop ?? 0)
    setTabState(next)
    try { localStorage.setItem('seam:tab', next) } catch { /* private mode */ }
  }
  // Restore the scroll position of the tab we return to.
  useLayoutEffect(() => { const y = scrollMemory.get(tab) ?? 0; requestAnimationFrame(() => view.current?.scrollTo({ top: y })) }, [tab, ready.value])

  useEffect(() => {
    performance.mark('seam:first-render')
    void initLock()
    // Warm the likely next screens and the Last.fm service once the first paint is done.
    const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback
    const idle = (f: () => void) => (ric ? ric(f, { timeout: 800 }) : setTimeout(f, 600))
    idle(() => { void Library.preload().catch(() => {}); void Studio.preload().catch(() => {}); void import('../connect/scrobbler').then(m => m.loadLastFm()).catch(() => {}) })
    const on = () => { online.value = true; notify(translate('Back online')) }, off = () => { online.value = false }
    const saveErr = () => notify(translate('Could not save your changes. Storage may be full.'))
    const rejection = (e: PromiseRejectionEvent) => { const r = e.reason; if (r && (r.name === 'AbortError' || /abort/i.test(String(r.message)))) return; console.error(r) }
    window.addEventListener('online', on); window.addEventListener('offline', off); window.addEventListener('seam:save-error', saveErr); window.addEventListener('unhandledrejection', rejection)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('seam:save-error', saveErr); window.removeEventListener('unhandledrejection', rejection) }
  }, [])
  useEffect(() => {
    const r = document.documentElement, st = settings.value
    r.style.fontSize = `${16 * st.textScale}px`
    r.classList.toggle('reduce-motion', st.reduceMotion); r.classList.toggle('high-contrast', st.highContrast)
  }, [settings.value.textScale, settings.value.reduceMotion, settings.value.highContrast])
  useLayoutEffect(() => {
    const applyLanguage = () => {
      const code = resolveLocale(settings.value.language, navigator.languages)
      void setLocaleAsync(code); document.documentElement.lang = code
    }
    applyLanguage()
    window.addEventListener('languagechange', applyLanguage)
    return () => window.removeEventListener('languagechange', applyLanguage)
  }, [settings.value.language])

  const bookActive = bookState.value.status !== 'idle' && !!bookState.value.trackId
  const hasTrack = bookActive || (engineState.value.index >= 0 && !!queueIds.value[engineState.value.index])
  const Current = tab === 'library' ? Library.Screen : tab === 'studio' ? Studio.Screen : tab === 'connect' ? Connect.Screen : tab === 'settings' ? Settings.Screen : null
  return (
    <div class="app">
      <div class="glow glow-bg" aria-hidden="true" />
      <main class={`view${hasTrack ? '' : ' no-mini'}`} ref={view} id="main" aria-label={translate(labels[tab])}>
        {!online.value && <div class="offline-banner" role="status">{translate('You are offline. Your downloaded library still plays; servers and cloud sources need a connection.')}</div>}
        <Boundary resetKey={tab}>
          {!ready.value ? <ScreenSkeleton /> : Current ? <Current /> : <Playlists />}
        </Boundary>
      </main>
      {hasTrack && (bookActive ? <MiniBook onOpen={() => setOpen(true)} /> : <MiniPlayer onOpen={() => setOpen(true)} />)}
      <div class="tab-fade" aria-hidden="true" />
      <nav class="tabbar" aria-label={translate("Main")}>
        {TABS.map(t => (
          <button class={tab === t ? 'on' : ''} onClick={() => setTab(t)} onPointerEnter={() => { if (t === 'library') void Library.preload().catch(() => {}); if (t === 'studio') void Studio.preload().catch(() => {}); if (t === 'connect') void Connect.preload().catch(() => {}); if (t === 'settings') void Settings.preload().catch(() => {}) }} aria-label={translate(labels[t])} aria-current={tab === t ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={icons[t]} /></svg>{translate(labels[t])}
          </button>))}
      </nav>
      {open && <Boundary>{bookActive ? <BookSheet.Screen onClose={() => setOpen(false)} /> : <NowPlaying onClose={() => setOpen(false)} />}</Boundary>}
      <DialogHost />
      {locked.value && <LockScreen />}
      {toast.value && <div class="toast" role="status">{toast.value}</div>}
      {undoToast.value && <div class="toast undo-toast" role="status"><span>{undoToast.value.msg}</span><button onClick={undoToast.value.run}>{undoToast.value.label}</button></div>}
    </div>
  )
}
