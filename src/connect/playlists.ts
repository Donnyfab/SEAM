export interface PlaylistEntry {
  url: string
  title?: string
  duration?: number
}

function duration(value: string): number | undefined {
  if (!value.trim()) return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

/** Relative URLs are preserved; the caller can resolve them against the playlist URL. */
export function parseM3U(text: string): PlaylistEntry[] {
  const entries: PlaylistEntry[] = []
  let metadata: Omit<PlaylistEntry, 'url'> = {}
  for (const raw of text.split(/\r\n|\n|\r/u)) {
    const line = raw.trim()
    if (!line) continue
    const info = /^#EXTINF:\s*([^,]*),(.*)$/iu.exec(line)
    if (info) {
      metadata = {}
      const seconds = duration(info[1]!)
      if (seconds !== undefined) metadata.duration = seconds
      const title = info[2]!.trim()
      if (title) metadata.title = title
    } else if (!line.startsWith('#')) {
      entries.push({ url: line, ...metadata })
      metadata = {}
    }
  }
  return entries
}

export function parsePLS(text: string): PlaylistEntry[] {
  const entries = new Map<number, Partial<PlaylistEntry>>()
  for (const raw of text.split(/\r\n|\n|\r/u)) {
    const match = /^(File|Title|Length)(\d+)\s*=\s*(.*)$/iu.exec(raw.trim())
    if (!match) continue
    const index = Number(match[2])
    if (!Number.isSafeInteger(index) || index < 1) continue
    const entry = entries.get(index) ?? {}
    const value = match[3]!.trim()
    switch (match[1]!.toLowerCase()) {
      case 'file': entry.url = value; break
      case 'title': if (value) entry.title = value; break
      case 'length': entry.duration = duration(value); break
    }
    entries.set(index, entry)
  }
  return [...entries].sort(([a], [b]) => a - b).flatMap(([, entry]) => {
    if (!entry.url) return []
    const result: PlaylistEntry = { url: entry.url }
    if (entry.title !== undefined) result.title = entry.title
    if (entry.duration !== undefined) result.duration = entry.duration
    return [result]
  })
}

/** Valid ICY metadata interval in bytes, or null for absent/invalid headers. */
export function parseIcyMetaInt(value: string | null | undefined): number | null {
  if (!value || !/^\d+$/u.test(value.trim())) return null
  const interval = Number(value)
  return Number.isSafeInteger(interval) && interval > 0 ? interval : null
}

export function parseStreamTitle(metadataString: string): string | undefined {
  return /(?:^|;)\s*StreamTitle\s*=\s*'([\s\S]*?)'\s*(?:;|\x00|$)/iu.exec(metadataString)?.[1]
}

/** An explicit playlist MIME type takes precedence over the URL extension. */
export function detectStreamKind(url: string, contentType?: string | null): 'm3u' | 'pls' | 'direct' {
  const mime = contentType?.split(';')[0]?.trim().toLowerCase()
  if (mime === 'audio/x-scpls' || mime === 'application/pls+xml') return 'pls'
  if (['audio/x-mpegurl', 'audio/mpegurl', 'application/x-mpegurl', 'application/vnd.apple.mpegurl'].includes(mime ?? '')) return 'm3u'
  const path = url.split(/[?#]/u)[0]!
  if (/\.m3u8?$/iu.test(path)) return 'm3u'
  if (/\.pls$/iu.test(path)) return 'pls'
  return 'direct'
}
