import { makeTransition, type TransitionSettings } from '../core/crossfade'
import type { RepeatMode } from '../core/queue'
import { EffectsChain } from './effects'
import { buildEnvelope, needsEnvelope, type EnvelopeSpec } from './envelope'

export interface PlayItem {
  id: string
  title: string
  artist: string
  album: string
  artwork?: string
  /** Decode on demand. Called for the current and next item only. */
  load: (ctx: BaseAudioContext) => Promise<AudioBuffer>
  trimStart?: number
  trimEnd?: number
  fadeIn?: number
  fadeOut?: number
  /** linear gain applied after decoding (e.g. loudness normalization) */
  gainFor?: (buffer: AudioBuffer) => number
}

export type EngineStatus = 'idle' | 'loading' | 'playing' | 'paused'
export interface EngineState { status: EngineStatus; index: number; duration: number; error?: string }

interface Voice {
  index: number
  src: AudioBufferSourceNode
  gain: GainNode
  /** ctx time corresponding to clip position 0 */
  t0: number
  dur: number
  buffer: AudioBuffer
  ended: boolean
  /** callbacks run once this voice has finished (used to bound how many tracks are decoded at once) */
  waiters: Array<() => void>
}

type Listener = (s: EngineState) => void

/**
 * Sample-accurate gapless/crossfade player. The next track is scheduled on the audio clock
 * while the current one plays, so transitions do not depend on JS timer precision.
 */
export class PlaybackEngine {
  readonly ctx: AudioContext
  readonly master: GainNode
  readonly fx: EffectsChain
  private fxBypass = false
  private fxNeutral = true
  items: PlayItem[] = []
  repeat: RepeatMode = 'off'
  /** global crossfade seconds used unless transitionAfter() overrides */
  crossfade = 0
  transitionAfter?: (index: number) => TransitionSettings
  private listeners = new Set<Listener>()
  private voices: Voice[] = []
  private gen = 0
  private state: EngineState = { status: 'idle', index: -1, duration: 0 }

  constructor(ctx?: AudioContext) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = ctx ?? new AC({ latencyHint: 'playback' })
    this.master = this.ctx.createGain()
    this.fx = new EffectsChain(this.ctx)
    this.master.connect(this.ctx.destination)
    this.fx.output.connect(this.ctx.destination)
    try { (navigator as unknown as { audioSession?: { type: string } }).audioSession && ((navigator as unknown as { audioSession: { type: string } }).audioSession.type = 'playback') } catch { /* optional API */ }
    this.ctx.addEventListener('statechange', () => this.maybeRecover())
    this.bindMediaSession()
  }

  subscribe(fn: Listener): () => void { this.listeners.add(fn); fn(this.state); return () => this.listeners.delete(fn) }
  getState(): EngineState { return this.state }
  private set(p: Partial<EngineState>) { this.state = { ...this.state, ...p }; this.listeners.forEach(l => l(this.state)); this.updateMediaSession() }

  /** Current position within the playing item, seconds. */
  position(): number {
    const v = this.voices.find(x => x.index === this.state.index && !x.ended) ?? this.voices.at(-1)
    if (!v) return 0
    return Math.min(Math.max(this.ctx.currentTime - v.t0, 0), v.dur)
  }

  setItems(items: PlayItem[]) { this.items = items }

  /** Studio preview is dry so it matches the exported mix; neutral effect settings are also routed around the chain (saves CPU/battery). */
  setFxRouting(opts: { bypass?: boolean; neutral?: boolean }) {
    if (opts.bypass !== undefined) this.fxBypass = opts.bypass
    if (opts.neutral !== undefined) this.fxNeutral = opts.neutral
    const direct = this.fxBypass || this.fxNeutral
    try { this.master.disconnect() } catch { /* not connected */ }
    this.master.connect(direct ? this.ctx.destination : this.fx.input)
  }

  async play(index: number, offset = 0): Promise<void> {
    if (!this.items[index]) return
    const gen = ++this.gen
    this.stopVoices()
    this.set({ status: 'loading', index, error: undefined })
    try {
      await this.ctx.resume()
      const item = this.items[index]!
      const buffer = await item.load(this.ctx)
      if (gen !== this.gen) return
      const t0 = this.ctx.currentTime + 0.05 - offset
      this.startVoice(index, buffer, t0, offset, gen)
      this.set({ status: 'playing', index })
    } catch (e) {
      if (gen === this.gen) this.set({ status: 'idle', error: e instanceof Error ? e.message : String(e) })
    }
  }

  async pause() { if (this.state.status === 'playing') { await this.ctx.suspend(); this.set({ status: 'paused' }) } }
  async resume() { if (this.state.status === 'paused') { await this.ctx.resume(); this.set({ status: 'playing' }) } }
  async toggle() { this.state.status === 'playing' ? await this.pause() : this.state.status === 'paused' ? await this.resume() : this.state.index >= 0 ? await this.play(this.state.index) : await this.play(0) }

  async seek(seconds: number) {
    if (this.state.index < 0) return
    const wasPaused = this.state.status === 'paused'
    await this.play(this.state.index, Math.max(0, seconds))
    if (wasPaused) await this.pause()
  }

  async next(auto = false) {
    const n = this.nextIndex(this.state.index, auto)
    if (n === null) { this.stop(); return }
    await this.play(n)
  }
  async previous() {
    if (this.position() > 3 || this.state.index <= 0) return this.play(Math.max(this.state.index, 0))
    await this.play(this.state.index - 1)
  }
  stop() { this.gen++; this.stopVoices(); this.set({ status: 'idle' }) }

  private nextIndex(i: number, auto: boolean): number | null {
    if (auto && this.repeat === 'one') return i
    if (i + 1 < this.items.length) return i + 1
    return this.repeat === 'all' && this.items.length ? 0 : null
  }

  private clipLen(item: PlayItem, buffer: AudioBuffer) {
    const end = Math.min(item.trimEnd ?? buffer.duration, buffer.duration)
    const start = Math.min(item.trimStart ?? 0, end)
    return { start, dur: end - start }
  }

  private transition(i: number): TransitionSettings { return this.transitionAfter?.(i) ?? makeTransition(this.crossfade) }

  /** Starts voice `index` so clip position 0 is at ctx time t0, then chains the next one. */
  private startVoice(index: number, buffer: AudioBuffer, t0: number, offset: number, gen: number, overlapIn = 0, curveIn: TransitionSettings['curve'] = 'equalPower', prev?: Voice) {
    const item = this.items[index]!
    const { start, dur } = this.clipLen(item, buffer)
    const nextI = this.nextIndex(index, true)
    const nextItem = nextI === null ? undefined : this.items[nextI]
    const tr = this.transition(index)
    const overlapOut = nextItem ? Math.min(tr.duration, dur) : 0

    const spec: EnvelopeSpec = { duration: dur, overlapIn, curveIn, overlapOut, curveOut: tr.curve, fadeIn: item.fadeIn ?? 0, fadeOut: item.fadeOut ?? 0 }
    const src = this.ctx.createBufferSource()
    const gain = this.ctx.createGain()
    src.buffer = buffer
    const trim = this.ctx.createGain()
    trim.gain.value = item.gainFor?.(buffer) ?? 1
    src.connect(gain).connect(trim).connect(this.master)
    const when = Math.max(t0 + offset, this.ctx.currentTime)
    if (needsEnvelope(spec)) {
      const env = buildEnvelope(spec, offset)
      gain.gain.setValueAtTime(env[0]!, when)
      if (dur - offset > 0.01) gain.gain.setValueCurveAtTime(env, when, dur - offset)
    }
    src.start(when, start + offset, dur - offset)
    const voice: Voice = { index, src, gain, t0, dur, buffer, ended: false, waiters: [] }
    this.voices.push(voice)
    src.onended = () => {
      voice.ended = true
      voice.waiters.splice(0).forEach(w => w())
      try { gain.disconnect(); trim.disconnect() } catch { /* already gone */ }
      this.voices = this.voices.filter(v => v !== voice)
      if (gen === this.gen && nextI === null && this.voices.length === 0) this.set({ status: 'idle' })
    }
    if (!prev) this.set({ duration: dur })

    if (nextI !== null && nextItem) {
      const go = () => void this.scheduleNext(nextI, nextItem, t0 + dur - overlapOut, overlapOut, tr.curve, gen, voice)
      // Only decode the following track once the previous voice is gone: at most ~3 buffers live at a time.
      if (prev && !prev.ended) prev.waiters.push(go); else go()
    }
  }

  private async scheduleNext(index: number, item: PlayItem, startAt: number, overlap: number, curve: TransitionSettings['curve'], gen: number, from: Voice) {
    try {
      const buffer = await item.load(this.ctx)
      if (gen !== this.gen) return
      // If decoding finished late, start as soon as possible rather than in the past.
      const t0 = Math.max(startAt, this.ctx.currentTime + 0.01)
      const late = t0 > startAt + 0.005
      this.startVoice(index, buffer, t0, 0, gen, late ? 0 : overlap, curve, from)
      this.pendingIndexSwitch(index, t0, gen)
    } catch (e) {
      if (gen === this.gen) this.set({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  private flipTo(index: number) {
    const v = this.voices.find(x => x.index === index && !x.ended)
    this.set(v ? { index, duration: v.dur } : { index })
  }

  /** Flip the reported index when the scheduled voice actually begins. */
  private pendingIndexSwitch(index: number, t0: number, gen: number) {
    const ms = Math.max(0, (t0 - this.ctx.currentTime) * 1000)
    setTimeout(() => { if (gen === this.gen && this.state.status === 'playing') this.flipTo(index) }, ms)
    // Also fall back to polling so a throttled timer does not leave the UI stale.
    const iv = setInterval(() => {
      if (gen !== this.gen) return clearInterval(iv)
      if (this.ctx.currentTime >= t0) { clearInterval(iv); if (this.state.index !== index && this.state.status === 'playing') this.flipTo(index) }
    }, 250)
  }

  private stopVoices() {
    for (const v of this.voices) {
      v.src.onended = null
      try { v.src.stop() } catch { /* not started */ }
      try { v.gain.disconnect() } catch { /* ok */ }
    }
    this.voices = []
  }

  private maybeRecover() {
    // iOS can move the context to 'interrupted' (calls, Siri); resume when we are meant to be playing.
    if ((this.ctx.state as string) === 'interrupted' && this.state.status === 'playing') void this.ctx.resume()
  }

  // ---- Media Session (lock screen / headphones) ----
  private bindMediaSession() {
    const ms = navigator.mediaSession
    if (!ms) return
    const h = (a: MediaSessionAction, f: MediaSessionActionHandler) => { try { ms.setActionHandler(a, f) } catch { /* unsupported */ } }
    h('play', () => void this.resume()); h('pause', () => void this.pause())
    h('nexttrack', () => void this.next()); h('previoustrack', () => void this.previous())
    h('seekto', d => { if (d.seekTime != null) void this.seek(d.seekTime) })
  }
  private updateMediaSession() {
    const ms = navigator.mediaSession
    const it = this.items[this.state.index]
    if (!ms || !it) return
    ms.metadata = new MediaMetadata({ title: it.title, artist: it.artist, album: it.album, artwork: it.artwork ? [{ src: it.artwork }] : [] })
    ms.playbackState = this.state.status === 'playing' ? 'playing' : this.state.status === 'paused' ? 'paused' : 'none'
  }
}
