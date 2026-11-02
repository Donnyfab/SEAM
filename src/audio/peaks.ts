function framesIn(channels: Float32Array[]): number {
  const frames = channels[0]?.length ?? 0;
  if (channels.some(channel => channel.length !== frames)) {
    throw new RangeError('Channels must have equal frame counts');
  }
  return frames;
}

function validateRate(sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('sampleRate must be positive and finite');
  }
}

/** Extrema across all channels, preserving peaks even in opposite-phase stereo.
 * When buckets exceed frames, each bucket repeats its corresponding frame.
 */
export function computePeaks(
  channels: Float32Array[], buckets: number,
): { min: Float32Array; max: Float32Array } {
  if (!Number.isInteger(buckets) || buckets < 0) {
    throw new RangeError('buckets must be a nonnegative integer');
  }
  const frames = framesIn(channels);
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  if (frames === 0) return { min, max };
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = Math.floor(bucket * frames / buckets);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * frames / buckets));
    let low = Infinity;
    let high = -Infinity;
    for (const channel of channels) {
      for (let frame = start; frame < end; frame++) {
        low = Math.min(low, channel[frame]!);
        high = Math.max(high, channel[frame]!);
      }
    }
    min[bucket] = low;
    max[bucket] = high;
  }
  return { min, max };
}

/** Bounds in seconds, with an exclusive end; empty/silent audio returns {0, 0}. */
export function detectSilenceBounds(
  channels: Float32Array[], sampleRate: number, thresholdDb = -50,
): { start: number; end: number } {
  validateRate(sampleRate);
  if (!Number.isFinite(thresholdDb)) throw new RangeError('thresholdDb must be finite');
  const frames = framesIn(channels);
  const threshold = 10 ** (thresholdDb / 20);
  let first = -1;
  let last = -1;
  for (let frame = 0; frame < frames; frame++) {
    if (channels.some(channel => Math.abs(channel[frame]!) > threshold)) {
      if (first === -1) first = frame;
      last = frame;
    }
  }
  return first === -1 ? { start: 0, end: 0 }
    : { start: first / sampleRate, end: (last + 1) / sampleRate };
}

export interface TransitionOptions {
  /** Non-overlapping RMS window length. Defaults to one second. */
  windowSeconds?: number;
  /** Search this many seconds from either edge. Defaults to 30. */
  edgeSeconds?: number;
  /** Fraction of median RMS used as the crossing threshold. Defaults to 0.25. */
  energyRatio?: number;
}

export interface TransitionPoint {
  time: number;
  kind: 'in' | 'out';
  confidence: number;
}

/** Find rising/falling threshold crossings, treating the track start as silence.
 * RMS combines channel power without phase cancellation. Confidence is the
 * relative distance from the threshold, in [0, 1]. Silent tracks have no points.
 */
export function findTransitionPoints(
  channels: Float32Array[], sampleRate: number, opts: TransitionOptions = {},
): TransitionPoint[] {
  validateRate(sampleRate);
  const frames = framesIn(channels);
  const { windowSeconds = 1, edgeSeconds = 30, energyRatio = 0.25 } = opts;
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0
    || !Number.isFinite(edgeSeconds) || edgeSeconds < 0
    || !Number.isFinite(energyRatio) || energyRatio <= 0 || energyRatio >= 1) {
    throw new RangeError('Invalid transition options');
  }
  if (frames === 0) return [];
  const windowFrames = Math.max(1, Math.round(windowSeconds * sampleRate));
  const levels: number[] = [];
  for (let start = 0; start < frames; start += windowFrames) {
    const end = Math.min(frames, start + windowFrames);
    let power = 0;
    for (const channel of channels) {
      for (let frame = start; frame < end; frame++) power += channel[frame]! ** 2;
    }
    levels.push(Math.sqrt(power / ((end - start) * channels.length)));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
  if (median === 0) return [];
  const threshold = median * energyRatio;
  const duration = frames / sampleRate;
  const points: TransitionPoint[] = [];
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i]!;
    const previous = levels[i - 1] ?? 0;
    const time = i * windowFrames / sampleRate;
    if (time <= edgeSeconds && level > threshold && previous <= threshold) {
      points.push({ time, kind: 'in', confidence: 1 - threshold / level });
    }
    if (time >= Math.max(0, duration - edgeSeconds)
      && level < threshold && previous >= threshold) {
      points.push({ time, kind: 'out', confidence: 1 - level / threshold });
    }
  }
  return points.sort((a, b) => b.confidence - a.confidence || a.time - b.time);
}
