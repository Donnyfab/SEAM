/**
 * Streaming player for audiobooks / very long files. Uses an <audio> element (not decoded buffers)
 * so hours of audio don't need hours of RAM, and so speed changes keep the pitch (preservesPitch).
 */
export type BookStatus = 'idle' | 'loading' | 'playing' | 'paused'
export interface BookMeta { id: string; title: string; artist: string; album: string; artwork?: string }
export interface BookState { status: BookStatus; trackId: string | null; position: number; duration: number; rate: number; meta?: BookMeta; live?: boolean }
type Listener = (s: BookState) => void

export class BookPlayer {
  private audio = new Audio()
  private url: string | null = null
  private meta: BookMeta | null = null
  private listeners = new Set<Listener>()
  private state: BookState = { status: 'idle', trackId: null, position: 0, duration: 0, rate: 1 }
  onProgress?: (trackId: string, position: number) => void
  private lastSave = 0

  constructor() {
    const a = this.audio
    a.preload = 'auto'
    ;(a as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true
    ;(a as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true
    a.addEventListener('timeupdate', () => {
      this.set({ position: a.currentTime, duration: Number.isFinite(a.duration) ? a.duration : this.state.duration })
      const now = Date.now()
      if (this.state.trackId && now - this.lastSave > 5000) { this.lastSave = now; this.onProgress?.(this.state.trackId, a.currentTime) }
      this.updatePosition()
    })
    a.addEventListener('play', () => this.set({ status: 'playing' }))
    a.addEventListener('pause', () => { if (this.state.status !== 'idle') { this.set({ status: 'paused' }); if (this.state.trackId) this.onProgress?.(this.state.trackId, a.currentTime) } })
    a.addEventListener('ended', () => { if (this.state.trackId) this.onProgress?.(this.state.trackId, 0); this.set({ status: 'paused', position: 0 }) })
    a.addEventListener('loadedmetadata', () => this.set({ duration: a.duration }))
    const ms = navigator.mediaSession
    const h = (n: MediaSessionAction, f: MediaSessionActionHandler) => { try { ms?.setActionHandler(n, f) } catch { /* unsupported */ } }
    h('play', () => void this.play()); h('pause', () => this.pause())
    h('seekbackward', d => this.skip(-(d.seekOffset ?? 15))); h('seekforward', d => this.skip(d.seekOffset ?? 30))
    h('seekto', d => { if (d.seekTime != null) this.seek(d.seekTime) })
  }

  subscribe(fn: Listener): () => void { this.listeners.add(fn); fn(this.state); return () => this.listeners.delete(fn) }
  getState() { return this.state }
  private set(p: Partial<BookState>) { this.state = { ...this.state, ...p }; this.listeners.forEach(l => l(this.state)) }

  async load(blob: Blob, meta: BookMeta, startAt = 0, rate = 1) {
    if (this.url) URL.revokeObjectURL(this.url)
    this.meta = meta
    this.url = URL.createObjectURL(blob)
    this.set({ status: 'loading', trackId: meta.id, position: startAt, rate, meta, live: false })
    this.audio.src = this.url
    this.audio.playbackRate = rate
    await new Promise<void>((res, rej) => { this.audio.onloadedmetadata = () => res(); this.audio.onerror = () => rej(new Error('This file could not be played')) })
    this.audio.currentTime = Math.min(startAt, this.audio.duration || startAt)
    if (navigator.mediaSession) navigator.mediaSession.metadata = new MediaMetadata({ title: meta.title, artist: meta.artist, album: meta.album, artwork: meta.artwork ? [{ src: meta.artwork }] : [] })
    await this.play()
  }

  /** Plays a live/online stream URL directly (no CORS needed for plain media playback). */
  async loadStream(url: string, meta: BookMeta, rate = 1) {
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null }
    this.meta = meta
    this.set({ status: 'loading', trackId: meta.id, position: 0, duration: 0, rate, meta, live: true })
    this.audio.src = url
    this.audio.playbackRate = 1
    if (navigator.mediaSession) navigator.mediaSession.metadata = new MediaMetadata({ title: meta.title, artist: meta.artist, album: meta.album })
    await this.play()
  }

  async play() { try { await this.audio.play() } catch (e) { this.set({ status: 'paused' }); throw e } }
  pause() { this.audio.pause() }
  toggle() { return this.audio.paused ? this.play() : (this.pause(), Promise.resolve()) }
  seek(t: number) { this.audio.currentTime = Math.max(0, Math.min(t, this.audio.duration || t)); this.set({ position: this.audio.currentTime }) }
  skip(d: number) { this.seek(this.audio.currentTime + d) }
  setRate(r: number) { const v = Math.min(Math.max(r, 0.5), 3); this.audio.playbackRate = v; this.set({ rate: v }) }
  stop() { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.set({ status: 'idle', trackId: null, position: 0 }) }
  position() { return this.audio.currentTime }

  private updatePosition() {
    const ms = navigator.mediaSession
    if (!ms?.setPositionState || !Number.isFinite(this.audio.duration)) return
    try { ms.setPositionState({ duration: this.audio.duration, position: this.audio.currentTime, playbackRate: this.audio.playbackRate }) } catch { /* ignore */ }
  }
}

/** Sleep-timer helper: returns a cancel function. */
export function sleepTimer(minutes: number, onFire: () => void): () => void {
  const id = setTimeout(onFire, minutes * 60_000)
  return () => clearTimeout(id)
}
