import { EQ_BANDS, distortionCurve, normalizeFx, reverbImpulse, type FxSettings } from './presets'

/** input → preamp → EQ → distortion → compressor → [dry + reverb + delay] → output */
export class EffectsChain {
  readonly input: GainNode
  readonly output: GainNode
  private readonly preamp: GainNode
  private readonly bands: BiquadFilterNode[]
  private readonly shaper: WaveShaperNode
  private readonly driveDry: GainNode
  private readonly driveWet: GainNode
  private readonly comp: DynamicsCompressorNode
  private readonly compBypass: GainNode
  private readonly compOn: GainNode
  private readonly mix: GainNode
  private readonly reverbSend: GainNode
  private readonly delaySend: GainNode
  private readonly delay: DelayNode
  private readonly feedback: GainNode

  constructor(private readonly ctx: AudioContext) {
    const c = ctx
    this.input = c.createGain(); this.output = c.createGain(); this.preamp = c.createGain()
    this.bands = EQ_BANDS.map(f => { const b = c.createBiquadFilter(); b.type = 'peaking'; b.frequency.value = f; b.Q.value = 1.1; return b })
    this.bands[0]!.type = 'lowshelf'; this.bands[EQ_BANDS.length - 1]!.type = 'highshelf'
    this.input.connect(this.preamp)
    let node: AudioNode = this.preamp
    for (const b of this.bands) { node.connect(b); node = b }
    // distortion: parallel dry/wet so drive=0 is a perfect bypass
    this.shaper = c.createWaveShaper(); this.shaper.oversample = '2x'
    this.driveDry = c.createGain(); this.driveWet = c.createGain()
    const afterDrive = c.createGain()
    node.connect(this.driveDry).connect(afterDrive); node.connect(this.shaper).connect(this.driveWet).connect(afterDrive)
    // compressor with bypass
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -24; this.comp.ratio.value = 4; this.comp.knee.value = 12; this.comp.attack.value = 0.01; this.comp.release.value = 0.25
    this.compBypass = c.createGain(); this.compOn = c.createGain(); this.mix = c.createGain()
    afterDrive.connect(this.compBypass).connect(this.mix)
    afterDrive.connect(this.comp).connect(this.compOn).connect(this.mix)
    // sends
    const rev = c.createConvolver(); const imp = reverbImpulse(c.sampleRate)
    const buf = c.createBuffer(2, imp[0]!.length, c.sampleRate); buf.copyToChannel(imp[0]! as Float32Array<ArrayBuffer>, 0); buf.copyToChannel(imp[1]! as Float32Array<ArrayBuffer>, 1); rev.buffer = buf
    this.reverbSend = c.createGain(); this.mix.connect(this.reverbSend).connect(rev).connect(this.output)
    this.delay = c.createDelay(2); this.feedback = c.createGain(); this.delaySend = c.createGain()
    this.mix.connect(this.delaySend).connect(this.delay); this.delay.connect(this.feedback).connect(this.delay); this.delay.connect(this.output)
    this.mix.connect(this.output)
    this.apply(normalizeFx(undefined))
  }

  apply(p: Partial<FxSettings>) {
    const f = normalizeFx(p); const t = this.ctx.currentTime
    // automatic headroom: boosted bands stack, so pull the level down by the largest boost to avoid clipping
    const headroom = Math.max(0, ...f.eq)
    this.preamp.gain.setTargetAtTime(10 ** ((f.preamp - headroom) / 20), t, 0.02)
    this.bands.forEach((b, i) => b.gain.setTargetAtTime(f.eq[i]!, t, 0.02))
    if (f.drive > 0) this.shaper.curve = distortionCurve(f.drive) as Float32Array<ArrayBuffer>
    this.driveDry.gain.setTargetAtTime(1 - f.drive, t, 0.02); this.driveWet.gain.setTargetAtTime(f.drive * 0.5, t, 0.02)
    this.compBypass.gain.setTargetAtTime(f.compressor ? 0 : 1, t, 0.02); this.compOn.gain.setTargetAtTime(f.compressor ? 1 : 0, t, 0.02)
    this.reverbSend.gain.setTargetAtTime(f.reverb * 0.6, t, 0.02)
    this.delay.delayTime.setTargetAtTime(f.delayTime, t, 0.02); this.feedback.gain.setTargetAtTime(f.delayFeedback, t, 0.02); this.delaySend.gain.setTargetAtTime(f.delayMix, t, 0.02)
  }
}
