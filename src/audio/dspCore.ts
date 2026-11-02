import { measureLufs, samplePeak } from './loudness';
import { computePeaks, detectSilenceBounds, findTransitionPoints } from './peaks';
import type { TransitionPoint } from './peaks';

export interface LoudnessMessage {
  type: 'loudness';
  id: number;
  channels: Float32Array[];
  sampleRate: number;
}

export interface AnalyzeMessage {
  type: 'analyze';
  id: number;
  mono: Float32Array;
  sampleRate: number;
  buckets: number;
}

export interface LoudnessResult { lufs: number; peak: number }
export interface AnalysisResult {
  min: Float32Array;
  max: Float32Array;
  silence: { start: number; end: number };
  points: TransitionPoint[];
}
export type DspMessage = LoudnessMessage | AnalyzeMessage;
export type DspResult = ({ id: number } & LoudnessResult) | ({ id: number } & AnalysisResult);

export function handleDspMessage(msg: LoudnessMessage): LoudnessResult & { id: number };
export function handleDspMessage(msg: AnalyzeMessage): AnalysisResult & { id: number };
export function handleDspMessage(msg: DspMessage): DspResult;
export function handleDspMessage(msg: DspMessage): DspResult {
  if (msg.type === 'loudness') {
    return { id: msg.id, lufs: measureLufs(msg.channels, msg.sampleRate), peak: samplePeak(msg.channels) };
  }
  const channels = [msg.mono];
  return {
    id: msg.id,
    ...computePeaks(channels, msg.buckets),
    silence: detectSilenceBounds(channels, msg.sampleRate),
    points: findTransitionPoints(channels, msg.sampleRate),
  };
}
