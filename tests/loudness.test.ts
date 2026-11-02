import { describe, expect, it } from 'vitest';
import { gainForTarget, measureLufs, samplePeak } from '../src/audio/loudness';

function sine(sampleRate: number, seconds = 3, amplitude = 0.1, hz = 997): Float32Array {
  return Float32Array.from({ length: Math.round(sampleRate * seconds) },
    (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / sampleRate));
}

describe('integrated loudness', () => {
  it.each([44100, 48000])('measures -20 dBFS combined stereo RMS at %i Hz', rate => {
    // Each channel has RMS 0.1/sqrt(2); summed stereo power is 0.01.
    const tone = sine(rate);
    expect(Math.abs(measureLufs([tone, tone], rate) + 20)).toBeLessThan(0.3);
  });

  it.each([32000, 88200, 96000])('recomputes K-weighting at %i Hz', rate => {
    const tone = sine(rate);
    expect(Math.abs(measureLufs([tone, tone], rate) + 20)).toBeLessThan(0.3);
  });

  it('sums channel power without phase cancellation or averaging', () => {
    const tone = sine(48000, 2, Math.SQRT2 * 0.1);
    const mono = measureLufs([tone], 48000);
    const stereo = measureLufs([tone, tone.map(value => -value)], 48000);
    expect(Math.abs(mono + 20)).toBeLessThan(0.3);
    expect(stereo - mono).toBeCloseTo(10 * Math.log10(2), 8);
    expect(Math.abs(stereo + 17)).toBeLessThan(0.3);
  });

  it('returns -Infinity for silence, empty input, and sub-block audio', () => {
    expect(measureLufs([], 48000)).toBe(-Infinity);
    expect(measureLufs([new Float32Array()], 48000)).toBe(-Infinity);
    expect(measureLufs([new Float32Array(48000)], 48000)).toBe(-Infinity);
    expect(measureLufs([sine(48000, 0.399)], 48000)).toBe(-Infinity);
    expect(Number.isFinite(measureLufs([sine(48000, 0.4)], 48000))).toBe(true);
  });

  it('applies the absolute -70 LUFS gate', () => {
    const below = sine(48000, 2, 0.0002);
    const above = sine(48000, 2, 0.0005);
    expect(measureLufs([below], 48000)).toBe(-Infinity);
    expect(Number.isFinite(measureLufs([above], 48000))).toBe(true);
  });

  it('excludes quiet sections using the relative -10 LU gate', () => {
    const rate = 48000;
    const loud = sine(rate, 4);
    const programme = new Float32Array(rate * 12);
    programme.set(loud);
    programme.set(sine(rate, 8, 0.001), loud.length);
    // All quiet blocks pass the absolute gate but fail the relative gate.
    expect(Math.abs(measureLufs([programme], rate) - measureLufs([loud], rate)))
      .toBeLessThan(0.25);
  });

  it('gates long silent sections without diluting the result', () => {
    const rate = 44100;
    const programme = new Float32Array(rate * 12);
    const loud = sine(rate, 4);
    programme.set(loud, rate * 4);
    expect(Math.abs(measureLufs([programme], rate) - measureLufs([loud], rate)))
      .toBeLessThan(0.4);
  });

  it('uses overlapping 400 ms blocks and ignores incomplete trailing blocks', () => {
    const rate = 48000;
    const first = sine(rate, 0.4);
    const signal = new Float32Array(rate * 0.5);
    signal.set(first);
    // Two windows: 0..400 ms at full power, 100..500 ms at about 75% power.
    const expectedDifference = 10 * Math.log10((1 + 0.75) / 2);
    expect(measureLufs([signal], rate) - measureLufs([first], rate))
      .toBeCloseTo(expectedDifference, 2);
    const tail = new Float32Array(signal.length + rate * 0.099);
    tail.set(signal);
    tail.fill(1, signal.length);
    expect(measureLufs([tail], rate)).toBe(measureLufs([signal], rate));
  });

  it('attenuates low frequencies and removes steady DC', () => {
    const rate = 48000;
    expect(measureLufs([sine(rate, 3, 0.1, 20)], rate))
      .toBeLessThan(measureLufs([sine(rate)], rate) - 10);
    const dc = new Float32Array(rate * 3).fill(0.1);
    expect(measureLufs([dc], rate)).toBeLessThan(-40);
  });

  it('does not mutate samples or retain filter state between calls', () => {
    const tone = sine(44100, 0.5);
    const original = tone.slice();
    const first = measureLufs([tone], 44100);
    expect(measureLufs([tone], 44100)).toBe(first);
    expect(tone).toEqual(original);
  });

  it('rejects invalid rates, mismatched lengths, and non-finite samples', () => {
    for (const rate of [0, -48000, NaN, Infinity, 3000]) {
      expect(() => measureLufs([], rate)).toThrow(RangeError);
    }
    expect(() => measureLufs([new Float32Array(2), new Float32Array(3)], 48000))
      .toThrow(RangeError);
    const invalid = sine(48000, 0.4);
    invalid[100] = NaN;
    expect(() => measureLufs([invalid], 48000)).toThrow(RangeError);
  });
});

describe('sample peak', () => {
  it('finds absolute peaks in any channel, including over full scale', () => {
    expect(samplePeak([new Float32Array([0.5, -0.25]), new Float32Array([-1.25])]))
      .toBe(1.25);
    expect(samplePeak([])).toBe(0);
    expect(samplePeak([new Float32Array(3)])).toBe(0);
    expect(() => samplePeak([new Float32Array([Infinity])])).toThrow(RangeError);
  });
});

describe('normalization gain', () => {
  it('converts loudness differences to linear gain with a default -14 LUFS target', () => {
    expect(gainForTarget(-20, undefined, 0.1)).toBeCloseTo(10 ** (6 / 20), 12);
    expect(gainForTarget(-10, -20, 0.5)).toBeCloseTo(10 ** (-10 / 20), 12);
    expect(gainForTarget(-20, -14, 0)).toBeCloseTo(10 ** (6 / 20), 12);
  });

  it.each([0.1, 0.5, 1, 2])('never exceeds the default ceiling for peak %f', peak => {
    const gain = gainForTarget(-40, -14, peak);
    expect(gain * peak).toBeLessThanOrEqual(10 ** (-1 / 20));
    expect(gain).toBeCloseTo(10 ** (-1 / 20) / peak, 12);
  });

  it('respects custom ceilings and attenuates already excessive peaks', () => {
    expect(gainForTarget(-14, -14, 1)).toBeCloseTo(10 ** (-1 / 20), 12);
    expect(gainForTarget(-30, -14, 0.5, -6) * 0.5).toBeCloseTo(10 ** (-6 / 20), 12);
  });

  it('handles silence without infinite gain while preserving the peak cap', () => {
    expect(gainForTarget(-Infinity, -14, 0)).toBe(1);
    expect(gainForTarget(-Infinity, -14, 1)).toBeCloseTo(10 ** (-1 / 20), 12);
  });

  it('rejects invalid inputs', () => {
    for (const args of [[NaN, -14, 0], [Infinity, -14, 0], [-20, NaN, 0],
      [-20, -14, -1], [-20, -14, Infinity], [-20, -14, 1, NaN]]) {
      expect(() => gainForTarget(args[0]!, args[1]!, args[2]!, args[3])).toThrow(RangeError);
    }
  });
});
