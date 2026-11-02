import { effect, signal } from '@preact/signals'
import { get, set } from 'idb-keyval'
import { LastFmClient, ScrobbleQueue, shouldScrobble } from './lastfm'
import { engineState, getEngine, queueIds, trackById, notify } from '../state'
import { rawStores } from '../library/store'

export interface LastFmConfig { apiKey: string; apiSecret: string; sessionKey: string; username: string }
export const lastfm = signal<LastFmConfig | null>(null)
let queue = new ScrobbleQueue()
const pendingCount = signal(0)
export { pendingCount as scrobblePending }

const { docsDB } = rawStores

export async function loadLastFm() {
  lastfm.value = (await get<LastFmConfig>('lastfm', docsDB)) ?? null
  queue = ScrobbleQueue.fromJSON(await get('scrobbleQueue', docsDB) ?? [])
  pendingCount.value = queue.toJSON().length
}
export async function saveLastFm(c: LastFmConfig | null) {
  lastfm.value = c
  if (c) await set('lastfm', c, docsDB); else await set('lastfm', null, docsDB)
}
const client = () => { const c = lastfm.value; return c ? new LastFmClient({ apiKey: c.apiKey, apiSecret: c.apiSecret, sessionKey: c.sessionKey }) : null }
export async function lastFmLogin(apiKey: string, apiSecret: string, username: string, password: string): Promise<LastFmConfig> {
  const sessionKey = await new LastFmClient({ apiKey, apiSecret }).getMobileSession(username, password)
  return { apiKey, apiSecret, sessionKey, username }
}

async function flush() {
  const c = client(); if (!c) return
  for (;;) {
    const batch = queue.takeBatch(50); if (!batch.length) break
    try { await c.scrobble(batch); queue.markDone(batch) } catch { break }
  }
  pendingCount.value = queue.toJSON().length
  await set('scrobbleQueue', queue.toJSON(), docsDB)
}

let current = { key: '', startedAt: 0, done: false }
effect(() => {
  const s = engineState.value
  const id = queueIds.peek()[s.index]
  const t = id ? trackById.peek().get(id) : undefined
  if (!lastfm.value || !t || s.status !== 'playing') return
  const key = `${id}:${s.index}`
  if (current.key === key) return
  current = { key, startedAt: Math.floor(Date.now() / 1000), done: false }
  void client()?.updateNowPlaying({ artist: t.artist, track: t.title, album: t.album, duration: Math.round(t.duration) }).catch(() => {})
})

setInterval(() => {
  const s = engineState.peek()
  if (!lastfm.peek() || s.status !== 'playing' || current.done) return
  const id = queueIds.peek()[s.index], t = id ? trackById.peek().get(id) : undefined
  if (!t || t.kind === 'audiobook') return
  if (shouldScrobble(getEngine().position(), t.duration)) {
    current.done = true
    queue.enqueue({ artist: t.artist, track: t.title, album: t.album, duration: Math.round(t.duration), timestamp: current.startedAt })
    pendingCount.value = queue.toJSON().length
    void flush().catch(() => notify('Last.fm: will retry scrobbles later'))
  }
}, 3000)
window.addEventListener('online', () => void flush())
export const flushScrobbles = flush
