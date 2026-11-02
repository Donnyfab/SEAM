import { parseXml } from './xml'
import type { XmlElement } from './xml'

export interface WebDavOptions {
  baseUrl: string
  username?: string
  password?: string
  fetchFn?: typeof fetch
}

export interface WebDavEntry {
  name: string
  /** Decoded path relative to baseUrl, with a leading slash. */
  path: string
  isDir: boolean
  size: number
  /** Modification time in milliseconds since the Unix epoch. */
  modified?: number
  contentType?: string
}

export class WebDavError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'WebDavError'
  }
}

export function isAudioName(name: string): boolean {
  return /\.(mp3|m4a|m4b|aac|flac|wav|wave|ogg|oga|opus|aif|aiff|alac|wma)$/i.test(name)
}

const propfindBody = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/></d:prop></d:propfind>'
const child = (element: XmlElement, name: string) => element.children.find(node => node.name === name)
const value = (element: XmlElement, name: string) => child(element, name)?.text.trim()
const successful = (status: string | undefined) => /^HTTP\/\S+\s+2\d\d\b/i.test(status ?? '')
const trimSlash = (path: string) => path.replace(/\/+$/, '')

export class WebDavClient {
  private readonly base: URL
  private readonly fetchFn: typeof fetch
  readonly authHeader: string | undefined

  constructor(options: WebDavOptions) {
    this.base = new URL(options.baseUrl)
    this.base.pathname = trimSlash(this.base.pathname) + '/'
    this.base.search = ''
    this.base.hash = ''
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis)
    this.authHeader = options.username !== undefined || options.password !== undefined
      ? 'Basic ' + btoa(Array.from(new TextEncoder().encode(`${options.username ?? ''}:${options.password ?? ''}`), byte => String.fromCharCode(byte)).join(''))
      : undefined
  }

  /** Accepts decoded, base-relative paths (including paths returned by list). */
  fileUrl(path: string): string {
    const segments = path.replace(/^\/+/, '').split('/')
    if (segments.some(segment => segment === '.' || segment === '..')) throw new Error('Invalid WebDAV path')
    return this.base.href + segments.map(segment => encodeURIComponent(segment)).join('/')
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers)
    if (this.authHeader !== undefined) headers.set('Authorization', this.authHeader)
    const response = await this.fetchFn(this.fileUrl(path), { ...init, headers })
    if (!response.ok) throw new WebDavError(response.status, `WebDAV HTTP error ${response.status}`)
    return response
  }

  private async properties(path: string, depth: '0' | '1'): Promise<XmlElement> {
    const response = await this.request(path, {
      method: 'PROPFIND', headers: { Depth: depth, 'Content-Type': 'application/xml; charset=utf-8' }, body: propfindBody,
    })
    try {
      const root = parseXml(await response.text())
      if (root.name !== 'multistatus') throw new Error('Expected multistatus')
      return root
    } catch {
      throw new WebDavError(response.status, 'Invalid WebDAV multistatus XML')
    }
  }

  async list(path: string): Promise<WebDavEntry[]> {
    const root = await this.properties(path, '1')
    const requestUrl = this.fileUrl(path)
    const self = trimSlash(decodeURIComponent(new URL(requestUrl).pathname))
    const basePath = trimSlash(decodeURIComponent(this.base.pathname))
    const entries: WebDavEntry[] = []
    for (const response of root.children.filter(node => node.name === 'response')) {
      const href = value(response, 'href')
      if (!href) continue
      const status = value(response, 'status')
      if (status && !successful(status)) continue
      let decodedPath: string
      try {
        const url = new URL(href, requestUrl.endsWith('/') ? requestUrl : requestUrl + '/')
        if (url.origin !== this.base.origin) continue
        decodedPath = trimSlash(decodeURIComponent(url.pathname))
      } catch { continue }
      if (decodedPath === self || !decodedPath.startsWith(basePath + '/')) continue
      const props = response.children.filter(node => node.name === 'propstat' && successful(value(node, 'status')))
        .flatMap(node => child(node, 'prop')?.children ?? [])
      if (!props.length) continue
      const prop: XmlElement = { name: 'prop', text: '', children: props }
      const isDir = child(prop, 'resourcetype')?.children.some(node => node.name === 'collection') ?? false
      const size = Number(value(prop, 'getcontentlength') ?? 0)
      const modified = Date.parse(value(prop, 'getlastmodified') ?? '')
      const contentType = value(prop, 'getcontenttype')
      entries.push({
        name: value(prop, 'displayname') || decodedPath.slice(decodedPath.lastIndexOf('/') + 1),
        path: decodedPath.slice(basePath.length), isDir,
        size: !isDir && Number.isFinite(size) && size >= 0 ? size : 0,
        ...(Number.isFinite(modified) ? { modified } : {}),
        ...(contentType ? { contentType } : {}),
      })
    }
    return entries
  }

  async get(path: string): Promise<Blob> {
    return (await this.request(path, { method: 'GET' })).blob()
  }

  async ping(): Promise<void> {
    await this.properties('/', '0')
  }
}
