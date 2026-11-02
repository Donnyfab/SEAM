import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleDspMessage } from '../src/audio/dspCore';
import type { DspMessage, DspResult } from '../src/audio/dspCore';
import {
  analyzeAsync, createDspClient, downmixToMono, excerptChannels, measureLoudnessAsync,
} from '../src/audio/dspClient';
import type { DspWorker } from '../src/audio/dspClient';
import { measureLufs, samplePeak } from '../src/audio/loudness';
import { computePeaks, detectSilenceBounds, findTransitionPoints } from '../src/audio/peaks';

const sampleRate = 8000;
function sine(): Float32Array {
  return Float32Array.from({ length: sampleRate * 3 }, (_, i) =>
    i < 1000 || i >= sampleRate * 2 ? 0 : 0.5 * Math.sin(2 * Math.PI * 440 * i / sampleRate));
}
function directAnalysis(mono: Float32Array, buckets = 20) {
  return {
    ...computePeaks([mono], buckets),
    silence: detectSilenceBounds([mono], sampleRate),
    points: findTransitionPoints([mono], sampleRate),
  };
}

class FakeWorker implements DspWorker {
  onmessage: DspWorker['onmessage'] = null;
  onerror: DspWorker['onerror'] = null;
  onmessageerror: DspWorker['onmessageerror'] = null;
  messages: DspMessage[] = [];
  transfers: Transferable[][] = [];
  terminate = vi.fn();
  postMessage(message: DspMessage, transfer: Transferable[]): void {
    this.transfers.push(transfer);
    this.messages.push(structuredClone(message, { transfer }));
  }
  reply(index: number): void {
    this.onmessage?.({ data: handleDspMessage(this.messages[index]!) } as MessageEvent<DspResult>);
  }
  error(): void {
    this.onerror?.({ message: 'worker crashed' } as ErrorEvent);
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('pure DSP handler', () => {
  for (const fixture of ['sine', 'silence'] as const) {
    it(`matches direct calls for ${fixture}`, () => {
      const mono = fixture === 'sine' ? sine() : new Float32Array(sampleRate * 3);
      const channels = [mono, mono.slice()];
      expect(handleDspMessage({ type: 'loudness', id: 7, channels, sampleRate })).toEqual({
        id: 7, lufs: measureLufs(channels, sampleRate), peak: samplePeak(channels),
      });
      expect(handleDspMessage({ type: 'analyze', id: 9, mono, sampleRate, buckets: 20 })).toEqual({
        id: 9, ...directAnalysis(mono),
      });
    });
  }
});

describe('DSP client', () => {
  it('lazily creates and reuses one worker, transfers inputs, and returns results', async () => {
    const worker = new FakeWorker();
    const factory = vi.fn(() => worker);
    const client = createDspClient(factory);
    expect(factory).not.toHaveBeenCalled();
    const channels = [sine(), sine()];
    const expected = { lufs: measureLufs(channels, sampleRate), peak: samplePeak(channels) };
    const loudness = client.measureLoudnessAsync(channels, sampleRate);
    expect(channels.map(channel => channel.byteLength)).toEqual([0, 0]);
    expect(worker.transfers[0]).toHaveLength(2);
    worker.reply(0);
    expect(await loudness).toEqual(expected);
    const mono = sine();
    const analysisExpected = directAnalysis(mono);
    const analysis = client.analyzeAsync(mono, sampleRate, 20);
    expect(mono.byteLength).toBe(0);
    worker.reply(1);
    expect(await analysis).toEqual(analysisExpected);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('correlates concurrent requests when replies arrive out of order', async () => {
    const worker = new FakeWorker();
    const client = createDspClient(() => worker);
    const mono = sine();
    const expected = directAnalysis(mono);
    const first = client.measureLoudnessAsync([new Float32Array(sampleRate)], sampleRate);
    const second = client.analyzeAsync(mono, sampleRate, 20);
    const third = client.measureLoudnessAsync([sine()], sampleRate);
    expect(new Set(worker.messages.map(message => message.id)).size).toBe(3);
    worker.reply(2);
    worker.reply(0);
    worker.reply(1);
    expect(await first).toEqual({ lufs: -Infinity, peak: 0 });
    expect(await second).toEqual(expected);
    expect((await third).peak).toBeCloseTo(0.5);
  });

  it('rejects all pending jobs on error and permanently yields before fallback', async () => {
    const worker = new FakeWorker();
    const factory = vi.fn(() => worker);
    const client = createDspClient(factory);
    const first = client.measureLoudnessAsync([sine()], sampleRate);
    const second = client.analyzeAsync(sine(), sampleRate, 20);
    const rejected = Promise.all([
      expect(first).rejects.toThrow('worker crashed'),
      expect(second).rejects.toThrow('worker crashed'),
    ]);
    worker.error();
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    const mono = sine();
    let settled = false;
    const fallback = client.analyzeAsync(mono, sampleRate, 20).then(result => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(await fallback).toEqual(directAnalysis(mono));
    expect(await client.measureLoudnessAsync([mono], sampleRate)).toEqual({
      lufs: measureLufs([mono], sampleRate), peak: samplePeak([mono]),
    });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('falls back when Worker is unavailable, including the default exports', async () => {
    vi.stubGlobal('Worker', undefined);
    const mono = sine();
    expect(await analyzeAsync(mono, sampleRate, 20)).toEqual(directAnalysis(mono));
    expect(await measureLoudnessAsync([mono], sampleRate)).toEqual({
      lufs: measureLufs([mono], sampleRate), peak: samplePeak([mono]),
    });
    expect(mono.byteLength).toBeGreaterThan(0);
  });

  it('permanently falls back if worker construction throws', async () => {
    const factory = vi.fn((): DspWorker => { throw new Error('unavailable'); });
    const client = createDspClient(factory);
    for (let i = 0; i < 2; i++) {
      expect(await client.analyzeAsync(new Float32Array(0), sampleRate, 0)).toEqual({
        min: new Float32Array(0), max: new Float32Array(0), silence: { start: 0, end: 0 }, points: [],
      });
    }
    expect(factory).toHaveBeenCalledOnce();
  });

  it('deduplicates shared input buffers in the transfer list', async () => {
    const worker = new FakeWorker();
    const client = createDspClient(() => worker);
    const mono = sine();
    const promise = client.measureLoudnessAsync([mono, mono], sampleRate);
    expect(worker.transfers[0]).toHaveLength(1);
    worker.reply(0);
    expect((await promise).peak).toBeCloseTo(0.5);
  });

  it('rejects invalid fallback jobs without breaking subsequent requests', async () => {
    vi.stubGlobal('Worker', undefined);
    const client = createDspClient();
    await expect(client.analyzeAsync(sine(), sampleRate, -1)).rejects.toThrow(RangeError);
    expect(await client.analyzeAsync(new Float32Array(0), sampleRate, 0)).toEqual({
      min: new Float32Array(0), max: new Float32Array(0), silence: { start: 0, end: 0 }, points: [],
    });
  });
});

describe('channel helpers', () => {
  it('averages all channels into an independent mono buffer', () => {
    const channels = [new Float32Array([1, -1, 0.5]), new Float32Array([-1, 0, 0.5])];
    const mono = downmixToMono(channels);
    expect([...mono]).toEqual([0, -0.5, 0.5]);
    expect([...downmixToMono([channels[0]!])]).toEqual([1, -1, 0.5]);
    mono[0] = 9;
    expect(channels[0]![0]).toBe(1);
    expect(downmixToMono([])).toEqual(new Float32Array(0));
    expect(() => downmixToMono([new Float32Array(1), new Float32Array(2)])).toThrow(RangeError);
  });

  it('copies a centered window, rounding down fractional frame counts', () => {
    const left = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const right = Float32Array.from(left, value => -value);
    const result = excerptChannels([left, right], 2, 2.4);
    expect(result.map(channel => [...channel])).toEqual([[3, 4, 5, 6], [-3, -4, -5, -6]]);
    result[0]![0] = 99;
    expect(left[3]).toBe(3);
    const full = excerptChannels([left], 2, 20)[0]!;
    expect(full).toEqual(left);
    expect(full.buffer).not.toBe(left.buffer);
    expect(excerptChannels([left], 2, 5)[0]!.buffer).not.toBe(left.buffer);
    expect([...excerptChannels([left], 2, 1.5)[0]!]).toEqual([3, 4, 5]);
    expect(excerptChannels([left], 2, 0)[0]).toHaveLength(0);
    expect(excerptChannels([], 2, 1)).toEqual([]);
  });

  it('validates excerpt parameters and channel lengths', () => {
    for (const rate of [0, -1, NaN, Infinity]) {
      expect(() => excerptChannels([], rate, 1)).toThrow(RangeError);
    }
    for (const seconds of [-1, NaN, Infinity]) {
      expect(() => excerptChannels([], 8000, seconds)).toThrow(RangeError);
    }
    expect(() => excerptChannels([new Float32Array(1), new Float32Array(2)], 2, 1)).toThrow(RangeError);
  });
});
