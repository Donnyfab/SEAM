import { afterEach, describe, expect, it, vi } from 'vitest'
import { NetworkError, resilientFetch } from '../src/connect/net'
import { explainNetworkError } from '../src/connect/sources'

const url = 'https://music.example/audio'
const ok = () => new Response('ok')
const failing = () => vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))
const pause = () => vi.fn<(ms: number) => Promise<void>>().mockResolvedValue()

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('resilientFetch', () => {
  it('defaults to two retries with exponential backoff and jitter', async () => {
    const fetchFn = failing(), sleep = pause()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    await expect(resilientFetch({ fetchFn, sleep })(url)).rejects.toMatchObject({ kind: 'network' })
    expect(fetchFn).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[600], [1200]])
  })

  it.each(['GET', 'HEAD', 'PROPFIND', 'OPTIONS'])('retries %s and returns a later success', async method => {
    const fetchFn = failing().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(ok())
    const response = await resilientFetch({ fetchFn, sleep: pause() })(url, { method: method.toLowerCase() })
    expect(response.ok).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('does not retry %s network or HTTP failures', async method => {
    const fetchFn = failing(), sleep = pause()
    const wrapped = resilientFetch({ fetchFn, sleep })
    await expect(wrapped(url, { method })).rejects.toBeInstanceOf(NetworkError)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    fetchFn.mockResolvedValue(new Response(null, { status: 503 }))
    expect((await wrapped(url, { method })).status).toBe(503)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(sleep).not.toHaveBeenCalled()
  })

  it.each([408, 429, 500, 502, 503, 504])('retries HTTP %s, returning the final response', async status => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status }))
    const response = await resilientFetch({ fetchFn, sleep: pause(), retries: 1 })(url)
    expect(response.status).toBe(status)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it.each([400, 401, 403, 404, 409, 422, 501])('does not retry HTTP %s', async status => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }))
    expect((await resilientFetch({ fetchFn, sleep: pause() })(url)).status).toBe(status)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it.each([['3', 3000], ['90', 10000], ['0.5', 500], ['garbage', 400], ['-1', 400], ['Wed, 21 Oct 2015 07:28:00 GMT', 400]])('handles Retry-After %s', async (header, delay) => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': header } })).mockResolvedValueOnce(ok())
    const sleep = pause()
    await resilientFetch({ fetchFn, sleep })(url)
    expect(sleep).toHaveBeenCalledWith(delay)
  })

  it('times out each attempt even when fetch ignores its signal', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const fetchFn = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      signals.push(init!.signal!)
      return new Promise<Response>(() => {})
    })
    const result = resilientFetch({ timeoutMs: 100, retries: 1, fetchFn, sleep: pause() })(url)
    const assertion = expect(result).rejects.toMatchObject({ kind: 'timeout' })
    await vi.advanceTimersByTimeAsync(200)
    await assertion
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(signals[0]).not.toBe(signals[1])
    expect(signals.every(s => s.aborted)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses a 20 second default timeout', async () => {
    vi.useFakeTimers()
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(() => {}))
    const result = resilientFetch({ fetchFn, retries: 0 })(url)
    const assertion = expect(result).rejects.toMatchObject({ kind: 'timeout' })
    await vi.advanceTimersByTimeAsync(19_999)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    await assertion
  })

  it.each(['option', 'init', 'request'])('immediately respects a pre-aborted %s signal', async source => {
    const controller = new AbortController(); controller.abort()
    const fetchFn = failing(), sleep = pause()
    const wrapped = resilientFetch({ fetchFn, sleep, signal: source === 'option' ? controller.signal : undefined })
    await expect(wrapped(source === 'request' ? new Request(url, { signal: controller.signal }) : url, source === 'init' ? { signal: controller.signal } : undefined)).rejects.toMatchObject({ kind: 'aborted' })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(sleep).not.toHaveBeenCalled()
  })

  it('combines wrapper and caller signals and cancels a pending attempt', async () => {
    vi.useFakeTimers()
    const option = new AbortController(), caller = new AbortController()
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(() => {}))
    const result = resilientFetch({ fetchFn, signal: option.signal })(url, { signal: caller.signal })
    const assertion = expect(result).rejects.toMatchObject({ kind: 'aborted' })
    await Promise.resolve()
    option.abort()
    await assertion
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn.mock.calls[0]![1]!.signal!.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([false, true])('aborts during backoff (injected sleep: %s)', async injected => {
    vi.useFakeTimers()
    const controller = new AbortController(), fetchFn = failing()
    const sleep = injected ? vi.fn(() => new Promise<void>(() => {})) : undefined
    const result = resilientFetch({ fetchFn, sleep })(url, { signal: controller.signal })
    const assertion = expect(result).rejects.toMatchObject({ kind: 'aborted' })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await assertion
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not retry an AbortError from fetch', async () => {
    const fetchFn = failing().mockRejectedValue(new DOMException('Cancelled', 'AbortError'))
    const sleep = pause()
    await expect(resilientFetch({ fetchFn, sleep })(url)).rejects.toMatchObject({ kind: 'aborted' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('detects offline status from navigator or an injected check', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await expect(resilientFetch({ fetchFn: failing(), retries: 0 })(url)).rejects.toMatchObject({ kind: 'offline' })
    await expect(resilientFetch({ fetchFn: failing(), retries: 0, isOnline: () => true })(url)).rejects.toMatchObject({ kind: 'network' })
    vi.stubGlobal('navigator', { onLine: true })
    await expect(resilientFetch({ fetchFn: failing(), retries: 0, isOnline: () => false })(url)).rejects.toMatchObject({ kind: 'offline' })
  })

  it('preserves Request methods, headers and bodies across retries', async () => {
    const bodies: string[] = []
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async input => {
      const request = input as Request
      expect(request.method).toBe('PROPFIND')
      expect(request.headers.get('Depth')).toBe('1')
      bodies.push(await request.text())
      return new Response(null, { status: bodies.length === 1 ? 503 : 200 })
    })
    await resilientFetch({ fetchFn, sleep: pause() })(new Request(url, { method: 'PROPFIND', headers: { Depth: '1' }, body: '<propfind />' }))
    expect(bodies).toEqual(['<propfind />', '<propfind />'])
  })

  it.each(['timeout', 'offline', 'network', 'aborted'] as const)('explains %s errors clearly', kind => {
    const message = explainNetworkError(new NetworkError(kind))
    expect(message).toContain({ timeout: 'The request timed out', offline: 'You are offline', network: 'Could not reach the server', aborted: 'The request was cancelled' }[kind])
  })
})
