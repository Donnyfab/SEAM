import { describe, expect, it } from 'vitest';
import { encodeWav, pcmBytes, wavHeader } from '../src/audio/wav';
import { computePeaks, detectSilenceBounds, findTransitionPoints } from '../src/audio/peaks';

function sine(seconds: number, sampleRate = 1000, amplitude = 0.8): Float32Array {
  return Float32Array.from({ length: seconds * sampleRate },
    (_, frame) => amplitude * Math.sin(2 * Math.PI * 25 * frame / sampleRate));
}

function tag(buffer: ArrayBuffer, offset: number): string {
  return String.fromCharCode(...new Uint8Array(buffer, offset, 4));
}

describe('WAV encoding', () => {
  it.each([16, 24, 32] as const)('writes a valid %i-bit stereo header', bitDepth => {
    const channels = [sine(1), sine(1, 1000, 0.4)];
    const buffer = encodeWav(channels, 1000, bitDepth);
    const view = new DataView(buffer);
    expect(tag(buffer, 0)).toBe('RIFF');
    expect(tag(buffer, 8)).toBe('WAVE');
    expect(tag(buffer, 12)).toBe('fmt ');
    expect(tag(buffer, 36)).toBe('data');
    expect(view.getUint32(4, true)).toBe(buffer.byteLength - 8);
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(bitDepth === 32 ? 3 : 1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(1000);
    expect(view.getUint32(28, true)).toBe(1000 * 2 * bitDepth / 8);
    expect(view.getUint16(32, true)).toBe(2 * bitDepth / 8);
    expect(view.getUint16(34, true)).toBe(bitDepth);
    expect(view.getUint32(40, true)).toBe(1000 * 2 * bitDepth / 8);
    expect(buffer.slice(0, 44)).toEqual(wavHeader(1000, 2, 1000, bitDepth));
  });

  it.each([16, 24] as const)('clamps, rounds, and interleaves %i-bit PCM', bitDepth => {
    const channels = [new Float32Array([-2, 0.5, 2]), new Float32Array([2, -0.5, 0])];
    const view = new DataView(pcmBytes(channels, bitDepth));
    const bytes = bitDepth / 8;
    const read = (offset: number): number => bitDepth === 16
      ? view.getInt16(offset, true)
      : (view.getUint8(offset) | view.getUint8(offset + 1) << 8
        | view.getInt8(offset + 2) << 16);
    const scale = 2 ** (bitDepth - 1);
    expect(Array.from({ length: 6 }, (_, i) => read(i * bytes)))
      .toEqual([-scale, scale - 1, Math.round(0.5 * (scale - 1)), -scale / 2, scale - 1, 0]);
  });

  it('preserves IEEE float samples outside integer full scale', () => {
    const view = new DataView(pcmBytes([new Float32Array([-2, 0.25]), new Float32Array([2, -0.5])], 32));
    expect(Array.from({ length: 4 }, (_, i) => view.getFloat32(i * 4, true)))
      .toEqual([-2, 2, 0.25, -0.5]);
  });

  it.each([16, 24, 32] as const)('streams arbitrary frame chunks at %i bits', bitDepth => {
    const channels = [sine(0.007), sine(0.007, 1000, 0.3)];
    const chunks = [pcmBytes(channels, bitDepth, 0, 1), pcmBytes(channels, bitDepth, 1, 4),
      pcmBytes(channels, bitDepth, 4)];
    const output = new Uint8Array(pcmBytes(channels, bitDepth).byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    expect(output.buffer).toEqual(pcmBytes(channels, bitDepth));
    expect(pcmBytes(channels, bitDepth, 2, 2).byteLength).toBe(0);
  });

  it('pads odd-length 24-bit chunks without counting padding as sample data', () => {
    const buffer = encodeWav([new Float32Array([1])], 44100, 24);
    const view = new DataView(buffer);
    expect(buffer.byteLength).toBe(48);
    expect(view.getUint32(4, true)).toBe(40);
    expect(view.getUint32(40, true)).toBe(3);
    expect(view.getUint8(47)).toBe(0);
  });

  it('supports zero frames and defaults to 16-bit', () => {
    expect(encodeWav([new Float32Array()], 48000).byteLength).toBe(44);
    expect(new DataView(encodeWav([new Float32Array([1])], 48000)).getInt16(44, true)).toBe(32767);
  });

  it('rejects invalid dimensions and ranges', () => {
    expect(() => encodeWav([], 1000)).toThrow(RangeError);
    expect(() => pcmBytes([new Float32Array(1), new Float32Array(2)], 16)).toThrow(RangeError);
    for (const [start, end] of [[-1, 1], [1, 0], [0, 3], [0.5, 1]]) {
      expect(() => pcmBytes([new Float32Array(2)], 16, start, end)).toThrow(RangeError);
    }
    for (const rate of [0, -1, NaN, Infinity, 1.5]) {
      expect(() => wavHeader(1, 1, rate, 16)).toThrow(RangeError);
    }
    expect(() => wavHeader(2 ** 32, 2, 48000, 32)).toThrow(RangeError);
    expect(() => wavHeader(-1, 1, 48000, 16)).toThrow(RangeError);
    expect(() => wavHeader(1, 0, 48000, 16)).toThrow(RangeError);
  });
});

describe('waveform peaks', () => {
  it('combines channel extrema without phase cancellation', () => {
    const samples = sine(1);
    const { min, max } = computePeaks([samples, samples.map(value => -value)], 10);
    expect(min).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(min[i]).toBeCloseTo(-0.8);
      expect(max[i]).toBeCloseTo(0.8);
    }
  });

  it('covers uneven buckets, including the final sample', () => {
    const { min, max } = computePeaks([new Float32Array([0.2, 0.4, -0.8, 0.1, 1])], 2);
    expect([...min]).toEqual([Math.fround(0.2), Math.fround(-0.8)]);
    expect([...max]).toEqual([Math.fround(0.4), 1]);
  });

  it('handles more buckets than samples, empty input, and zero buckets', () => {
    const peaks = computePeaks([new Float32Array([-1, 1])], 4);
    expect([...peaks.min]).toEqual([-1, -1, 1, 1]);
    expect([...peaks.max]).toEqual([-1, -1, 1, 1]);
    expect([...computePeaks([], 3).min]).toEqual([0, 0, 0]);
    expect(computePeaks([sine(1)], 0).max).toHaveLength(0);
    expect(() => computePeaks([], -1)).toThrow(RangeError);
    expect(() => computePeaks([], 1.5)).toThrow(RangeError);
  });
});

describe('silence bounds', () => {
  it('finds non-silent frames in any channel with an exclusive end', () => {
    const signal = new Float32Array(4000);
    signal.set(sine(2), 1000);
    expect(detectSilenceBounds([new Float32Array(4000), signal], 1000))
      .toEqual({ start: 1.001, end: 3 });
  });

  it('uses the requested dB amplitude threshold', () => {
    const signal = new Float32Array([0, 0.005, 0.02, 0]);
    expect(detectSilenceBounds([signal], 10, -40)).toEqual({ start: 0.2, end: 0.3 });
    expect(detectSilenceBounds([signal], 10)).toEqual({ start: 0.1, end: 0.3 });
  });

  it('handles silence, empty audio, and full-length activity', () => {
    expect(detectSilenceBounds([], 1000)).toEqual({ start: 0, end: 0 });
    expect(detectSilenceBounds([new Float32Array(1000)], 1000)).toEqual({ start: 0, end: 0 });
    expect(detectSilenceBounds([new Float32Array([1, -1])], 2)).toEqual({ start: 0, end: 1 });
  });
});

describe('transition candidates', () => {
  it('finds sine entrance and quiet outro and ranks by confidence', () => {
    const signal = new Float32Array(80000);
    signal.set(sine(70), 5000);
    const points = findTransitionPoints([signal, signal.map(value => -value)], 1000);
    expect(points.map(({ time, kind }) => ({ time, kind })))
      .toEqual([{ time: 75, kind: 'out' }, { time: 5, kind: 'in' }]);
    expect(points[0]!.confidence).toBe(1);
    expect(points[1]!.confidence).toBeCloseTo(0.75);
  });

  it('ignores crossings outside the edge ranges', () => {
    const signal = sine(100);
    signal.fill(0, 40000, 45000);
    const points = findTransitionPoints([signal], 1000);
    expect(points.map(point => point.time)).toEqual([0]);
  });

  it('uses RMS rather than individual zero crossings or peaks', () => {
    const signal = sine(80);
    signal.set(sine(5, 1000, 0.1), 75000);
    const points = findTransitionPoints([signal], 1000);
    const outro = points.find(point => point.kind === 'out');
    expect(outro?.time).toBe(75);
    expect(outro?.confidence).toBeCloseTo(0.5);
    expect(points).toHaveLength(2);
  });

  it('handles partial windows, short tracks, silence and options', () => {
    expect(findTransitionPoints([], 1000)).toEqual([]);
    expect(findTransitionPoints([new Float32Array(10000)], 1000)).toEqual([]);
    expect(findTransitionPoints([sine(0.5)], 1000)[0]?.time).toBe(0);
    const signal = new Float32Array(10000);
    signal.set(sine(8), 1000);
    expect(findTransitionPoints([signal], 1000, { windowSeconds: 0.5, edgeSeconds: 2, energyRatio: 0.5 })
      .map(point => point.time)).toEqual([9, 1]);
  });

  it('rejects mismatched channels and invalid analysis parameters', () => {
    const channels = [new Float32Array(1), new Float32Array(2)];
    expect(() => computePeaks(channels, 1)).toThrow(RangeError);
    expect(() => detectSilenceBounds(channels, 1000)).toThrow(RangeError);
    expect(() => findTransitionPoints(channels, 1000)).toThrow(RangeError);
    expect(() => detectSilenceBounds([], 0)).toThrow(RangeError);
    expect(() => detectSilenceBounds([], 1000, NaN)).toThrow(RangeError);
    expect(() => findTransitionPoints([], NaN)).toThrow(RangeError);
    expect(() => findTransitionPoints([], 1000, { windowSeconds: 0 })).toThrow(RangeError);
    expect(() => findTransitionPoints([], 1000, { edgeSeconds: -1 })).toThrow(RangeError);
    expect(() => findTransitionPoints([], 1000, { energyRatio: 1 })).toThrow(RangeError);
  });
});
