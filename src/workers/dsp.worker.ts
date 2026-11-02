import { handleDspMessage } from '../audio/dspCore';
import type { DspMessage } from '../audio/dspCore';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<DspMessage>) => {
  const result = handleDspMessage(event.data);
  const transfer = 'min' in result
    ? [result.min.buffer, result.max.buffer].filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer)
    : [];
  scope.postMessage(result, transfer);
};
