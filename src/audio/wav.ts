/** RIFF/WAVE encoding. Integer PCM uses asymmetric full-scale signed ranges. */
type BitDepth = 16 | 24 | 32;

function bytesPerSample(bitDepth: BitDepth): number {
  if (bitDepth !== 16 && bitDepth !== 24 && bitDepth !== 32) {
    throw new RangeError('bitDepth must be 16, 24, or 32');
  }
  return bitDepth / 8;
}

function frameCount(channels: Float32Array[]): number {
  if (channels.length === 0) throw new RangeError('At least one channel is required');
  const frames = channels[0]!.length;
  if (channels.some(channel => channel.length !== frames)) {
    throw new RangeError('Channels must have equal frame counts');
  }
  return frames;
}

/** A 44-byte header; an odd-length data chunk requires one trailing zero pad byte. */
export function wavHeader(
  totalFrames: number, numChannels: number, sampleRate: number, bitDepth: BitDepth,
): ArrayBuffer {
  const bytes = bytesPerSample(bitDepth);
  const blockAlign = numChannels * bytes;
  const dataSize = totalFrames * blockAlign;
  const riffSize = 36 + dataSize + (dataSize % 2);
  if (!Number.isSafeInteger(totalFrames) || totalFrames < 0
    || !Number.isInteger(numChannels) || numChannels < 1 || numChannels > 65535
    || !Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 0xffffffff
    || blockAlign > 65535 || sampleRate * blockAlign > 0xffffffff
    || !Number.isSafeInteger(dataSize) || riffSize > 0xffffffff) {
    throw new RangeError('Invalid or oversized WAV dimensions');
  }
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const tag = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  tag(0, 'RIFF');
  view.setUint32(4, riffSize, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  tag(36, 'data');
  view.setUint32(40, dataSize, true);
  return buffer;
}

/** Interleaved little-endian samples for [start, end), without RIFF padding. */
export function pcmBytes(
  channels: Float32Array[], bitDepth: BitDepth, start = 0, end?: number,
): ArrayBuffer {
  const frames = frameCount(channels);
  const stop = end ?? frames;
  const bytes = bytesPerSample(bitDepth);
  if (!Number.isInteger(start) || !Number.isInteger(stop)
    || start < 0 || stop < start || stop > frames) {
    throw new RangeError('Invalid PCM frame range');
  }
  const buffer = new ArrayBuffer((stop - start) * channels.length * bytes);
  const view = new DataView(buffer);
  let offset = 0;
  for (let frame = start; frame < stop; frame++) {
    for (const channel of channels) {
      const sample = channel[frame]!;
      if (bitDepth === 32) {
        view.setFloat32(offset, sample, true);
      } else {
        const clamped = Number.isNaN(sample) ? 0 : Math.max(-1, Math.min(1, sample));
        const scale = 2 ** (bitDepth - 1);
        const value = Math.round(clamped * (clamped < 0 ? scale : scale - 1));
        if (bitDepth === 16) view.setInt16(offset, value, true);
        else {
          view.setUint8(offset, value & 0xff);
          view.setUint8(offset + 1, (value >> 8) & 0xff);
          view.setUint8(offset + 2, (value >> 16) & 0xff);
        }
      }
      offset += bytes;
    }
  }
  return buffer;
}

export function encodeWav(
  channels: Float32Array[], sampleRate: number, bitDepth: BitDepth = 16,
): ArrayBuffer {
  const header = wavHeader(frameCount(channels), channels.length, sampleRate, bitDepth);
  const data = pcmBytes(channels, bitDepth);
  const result = new Uint8Array(44 + data.byteLength + (data.byteLength % 2));
  result.set(new Uint8Array(header));
  result.set(new Uint8Array(data), 44);
  return result.buffer;
}
