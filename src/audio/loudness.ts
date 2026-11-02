interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // Bilinear designs matching BS.1770's reference coefficients at 48 kHz.
  // Constants describe the shelf and RLB prototypes, not fixed-rate biquads.
  const k = Math.tan(Math.PI * 1681.974450955533 / sampleRate);
  const q = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  const shelf: Biquad = {
    b0: (vh + vb * k / q + k * k) / a0,
    b1: 2 * (k * k - vh) / a0,
    b2: (vh - vb * k / q + k * k) / a0,
    a1: 2 * (k * k - 1) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
  const r = Math.tan(Math.PI * 38.13547087602444 / sampleRate);
  const rq = 0.5003270373238773;
  const r0 = 1 + r / rq + r * r;
  return [shelf, {
    // The RLB numerator is deliberately not divided by r0 (BS.1770).
    b0: 1, b1: -2, b2: 1,
    a1: 2 * (r * r - 1) / r0,
    a2: (1 - r / rq + r * r) / r0,
  }];
}

/** Integrated LUFS with 400 ms blocks and 75% overlap, using both R128 gates.
 * Channels have unit power weights (mono/stereo or other non-surround channels).
 * A surround/LFE layout needs explicit channel mapping before calling this API.
 * Incomplete trailing blocks are ignored; less than 400 ms returns -Infinity.
 * Rates must place the K-weighting shelf below Nyquist.
 */
export function measureLufs(channels: Float32Array[], sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 2 * 1681.974450955533) {
    throw new RangeError('sampleRate must be finite and exceed the K-weighting Nyquist limit');
  }
  const frames = channels[0]?.length ?? 0;
  if (channels.some(channel => channel.length !== frames)) {
    throw new RangeError('Channels must have equal frame counts');
  }
  const blockSize = Math.round(0.4 * sampleRate);
  const hop = Math.round(0.1 * sampleRate);
  if (frames < blockSize) return -Infinity;
  const energies = new Float64Array(1 + Math.floor((frames - blockSize) / hop));
  const [shelf, rlb] = kWeighting(sampleRate);
  const ring = new Float64Array(blockSize);
  for (const channel of channels) {
    ring.fill(0);
    let s1 = 0;
    let s2 = 0;
    let r1 = 0;
    let r2 = 0;
    let sum = 0;
    let block = 0;
    for (let frame = 0; frame < frames; frame++) {
      const input = channel[frame]!;
      if (!Number.isFinite(input)) throw new RangeError('Samples must be finite');
      const pre = shelf.b0 * input + s1;
      s1 = shelf.b1 * input - shelf.a1 * pre + s2;
      s2 = shelf.b2 * input - shelf.a2 * pre;
      const weighted = rlb.b0 * pre + r1;
      r1 = rlb.b1 * pre - rlb.a1 * weighted + r2;
      r2 = rlb.b2 * pre - rlb.a2 * weighted;
      const power = weighted * weighted;
      const slot = frame % blockSize;
      sum += power - ring[slot]!;
      ring[slot] = power;
      if (frame + 1 >= blockSize && (frame + 1 - blockSize) % hop === 0) {
        energies[block] = energies[block]! + Math.max(0, sum) / blockSize;
        block++;
      }
    }
  }
  const absolute = 10 ** ((-70 + 0.691) / 10);
  let sum = 0;
  let count = 0;
  for (const energy of energies) {
    if (energy > absolute) { sum += energy; count++; }
  }
  if (count === 0) return -Infinity;
  const gate = Math.max(absolute, sum / count / 10);
  sum = 0;
  count = 0;
  for (const energy of energies) {
    if (energy > gate) { sum += energy; count++; }
  }
  return count === 0 ? -Infinity : -0.691 + 10 * Math.log10(sum / count);
}

/** Largest absolute sample across channels; empty input returns zero. */
export function samplePeak(channels: Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) {
    for (const sample of channel) {
      if (!Number.isFinite(sample)) throw new RangeError('Samples must be finite');
      peak = Math.max(peak, Math.abs(sample));
    }
  }
  return peak;
}

/** Linear normalization gain capped by the sample-peak ceiling (not true peak).
 * Ungated/silent measurements use unity gain, still subject to the peak cap.
 */
export function gainForTarget(
  measuredLufs: number, targetLufs = -14, peak: number, maxPeakDb = -1,
): number {
  if ((measuredLufs !== -Infinity && !Number.isFinite(measuredLufs))
    || !Number.isFinite(targetLufs) || !Number.isFinite(peak) || peak < 0
    || !Number.isFinite(maxPeakDb)) {
    throw new RangeError('Invalid loudness or peak parameters');
  }
  const desired = measuredLufs === -Infinity ? 1 : 10 ** ((targetLufs - measuredLufs) / 20);
  const ceiling = 10 ** (maxPeakDb / 20);
  const gain = Math.min(desired, peak > 0 ? ceiling / peak : Number.MAX_VALUE);
  // Division followed by multiplication can round one ULP above the ceiling.
  return gain * peak > ceiling ? gain * (1 - Number.EPSILON) : gain;
}
