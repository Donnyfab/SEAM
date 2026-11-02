import { handleDspMessage } from './dspCore';
import type { AnalysisResult, DspMessage, DspResult, LoudnessResult } from './dspCore';
export type { AnalysisResult } from './dspCore';

/** Minimal worker surface so tests can inject an in-memory worker. */
export interface DspWorker {
  onmessage: ((event: MessageEvent<DspResult>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: DspMessage, transfer: Transferable[]): void;
  terminate(): void;
}
export type WorkerFactory = () => DspWorker;

/** Creates an isolated client; the public convenience functions share one client. */
export function createDspClient(workerFactory?: WorkerFactory) {
  let worker: DspWorker | undefined;
  let fallback = false;
  let nextId = 0;
  const pending = new Map<number, {
    resolve: (result: DspResult) => void;
    reject: (error: Error) => void;
  }>();

  function fail(error: Error): void {
    fallback = true;
    const failed = worker;
    worker = undefined;
    if (failed) {
      failed.onmessage = null;
      failed.onerror = null;
      failed.onmessageerror = null;
      failed.terminate();
    }
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }

  async function request(message: DspMessage): Promise<DspResult> {
    if (!fallback && !worker) {
      if (!workerFactory && typeof Worker === 'undefined') {
        fallback = true;
      } else {
        try {
          worker = workerFactory ? workerFactory()
            : new Worker(new URL('../workers/dsp.worker.ts', import.meta.url), { type: 'module' });
          worker.onmessage = ({ data }) => {
            const waiting = pending.get(data.id);
            pending.delete(data.id);
            waiting?.resolve(data);
          };
          worker.onerror = event => fail(new Error(event.message || 'DSP worker failed'));
          worker.onmessageerror = () => fail(new Error('DSP worker reply could not be decoded'));
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }
    if (fallback) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      return handleDspMessage(message);
    }
    return new Promise<DspResult>((resolve, reject) => {
      pending.set(message.id, { resolve, reject });
      const inputs = message.type === 'loudness' ? message.channels : [message.mono];
      const transfer = [...new Set(inputs.map(channel => channel.buffer))]
        .filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
      try {
        worker!.postMessage(message, transfer);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  return {
    /** Transfers input buffers. Pass copies owned exclusively by the caller. */
    async measureLoudnessAsync(channels: Float32Array[], sampleRate: number): Promise<LoudnessResult> {
      const result = await request({ type: 'loudness', id: nextId++, channels, sampleRate });
      if (!('lufs' in result)) throw new Error('Unexpected DSP loudness reply');
      return { lufs: result.lufs, peak: result.peak };
    },
    /** Transfers the input buffer. Pass a copy owned exclusively by the caller. */
    async analyzeAsync(mono: Float32Array, sampleRate: number, buckets: number): Promise<AnalysisResult> {
      const result = await request({ type: 'analyze', id: nextId++, mono, sampleRate, buckets });
      if (!('min' in result)) throw new Error('Unexpected DSP analysis reply');
      return { min: result.min, max: result.max, silence: result.silence, points: result.points };
    },
  };
}

const defaultClient = createDspClient();
/** Transfers channel buffers: callers must pass copies they exclusively own. */
export const measureLoudnessAsync = defaultClient.measureLoudnessAsync;
/** Transfers the mono buffer: callers must pass a copy they exclusively own. */
export const analyzeAsync = defaultClient.analyzeAsync;

function frameCount(channels: Float32Array[]): number {
  const frames = channels[0]?.length ?? 0;
  if (channels.some(channel => channel.length !== frames)) {
    throw new RangeError('Channels must have equal frame counts');
  }
  return frames;
}

/** Average all channels into a new, independently owned mono buffer. */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  const mono = new Float32Array(frameCount(channels));
  for (let frame = 0; frame < mono.length; frame++) {
    let sum = 0;
    for (const channel of channels) sum += channel[frame]!;
    mono[frame] = sum / channels.length;
  }
  return mono;
}

/** Copy a centered window, rounding down to at most maxSeconds of audio. */
export function excerptChannels(
  channels: Float32Array[], sampleRate: number, maxSeconds: number,
): Float32Array[] {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0
    || !Number.isFinite(maxSeconds) || maxSeconds < 0) {
    throw new RangeError('Invalid excerpt duration or sample rate');
  }
  const frames = frameCount(channels);
  const length = Math.min(frames, Math.floor(sampleRate * maxSeconds));
  const start = Math.floor((frames - length) / 2);
  return channels.map(channel => channel.slice(start, start + length));
}
