export type NetworkErrorKind = 'timeout' | 'offline' | 'network' | 'aborted'

export class NetworkError extends Error {
  constructor(public readonly kind: NetworkErrorKind, options?: ErrorOptions) {
    super({ timeout: 'The request timed out', offline: 'You are offline', network: 'Could not reach the server', aborted: 'The request was cancelled' }[kind], options)
    this.name = 'NetworkError'
  }
}

export interface ResilientFetchOptions {
  timeoutMs?: number
  retries?: number
  baseDelayMs?: number
  fetchFn?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
  /** Defaults to navigator.onLine; absent navigator is treated as online. */
  isOnline?: () => boolean
}

const retryMethods = new Set(['GET', 'HEAD', 'PROPFIND', 'OPTIONS'])
const retryStatuses = new Set([408, 429, 500, 502, 503, 504])

/** Race even injected operations that do not themselves observe AbortSignal. */
function abortable<T>(operation: () => Promise<T>, signal: AbortSignal, error: () => NetworkError): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(error()) }
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => {
      if (signal.aborted) throw error()
      return operation()
    }).then(value => { signal.removeEventListener('abort', abort); resolve(value) }, cause => {
      signal.removeEventListener('abort', abort)
      reject(cause)
    })
  })
}

/** Retry transient failures for methods that are safe to repeat. HTTP errors remain responses. */
export function resilientFetch(opts: ResilientFetchOptions = {}): typeof fetch {
  const {
    timeoutMs = 20_000, retries = 2, baseDelayMs = 400,
    fetchFn = globalThis.fetch.bind(globalThis), sleep,
    isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false,
  } = opts
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    const caller = new AbortController()
    const signals = new Set([opts.signal, init?.signal ?? request?.signal].filter((s): s is AbortSignal => !!s))
    const cancel = () => caller.abort()
    for (const signal of signals) {
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
    }
    const aborted = () => new NetworkError('aborted')
    try {
      for (let attempt = 0; ; attempt++) {
        if (caller.signal.aborted) throw aborted()
        const controller = new AbortController()
        let timedOut = false
        const abortAttempt = () => controller.abort()
        caller.signal.addEventListener('abort', abortAttempt, { once: true })
        const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
        const failure = () => new NetworkError(caller.signal.aborted ? 'aborted' : timedOut ? 'timeout' : !isOnline() ? 'offline' : 'network')
        let response: Response | undefined
        let error: NetworkError | undefined
        try {
          response = await abortable(() => fetchFn(request ? request.clone() : input, { ...init, signal: controller.signal }), controller.signal, failure)
        } catch (cause) {
          const kind = failure().kind
          error = new NetworkError(kind === 'network' && cause instanceof Error && cause.name === 'AbortError' ? 'aborted' : kind, { cause })
        } finally {
          clearTimeout(timer)
          caller.signal.removeEventListener('abort', abortAttempt)
        }
        if (caller.signal.aborted) throw aborted()
        if (error?.kind === 'aborted') throw error
        if (!retryMethods.has(method) || attempt >= retries || (response && !retryStatuses.has(response.status))) {
          if (error) throw error
          return response!
        }
        const header = response?.headers.get('Retry-After')?.trim()
        const retryAfter = header && /^\d+(\.\d+)?$/.test(header) ? Math.min(Number(header) * 1000, 10_000) : 0
        const delay = Math.max(baseDelayMs * 2 ** attempt * (1 + Math.random()), retryAfter)
        // Release a discarded response without delaying cancellation on a streaming body.
        if (response?.body) void response.body.cancel().catch(() => {})
        await abortable(() => sleep ? sleep(delay) : new Promise<void>(resolve => {
          const timer = setTimeout(() => { caller.signal.removeEventListener('abort', clear); resolve() }, delay)
          const clear = () => clearTimeout(timer)
          caller.signal.addEventListener('abort', clear, { once: true })
        }), caller.signal, aborted)
      }
    } finally {
      for (const signal of signals) signal.removeEventListener('abort', cancel)
    }
  }
}
