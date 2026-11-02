export interface BackupManifest {
  version: 1
  createdAt: number
  tracks: unknown[]
  playlists: unknown[]
  arrangements: unknown[]
  settings: unknown
  bookmarks: unknown[]
}

export class BackupError extends Error {
  override name = 'BackupError'
}

export type BackupParts = Pick<BackupManifest, 'tracks' | 'settings'> &
  Partial<Pick<BackupManifest, 'createdAt' | 'playlists' | 'arrangements' | 'bookmarks'>>

function validate(value: unknown): BackupManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BackupError('Backup must be an object')
  }
  const data = value as Record<string, unknown>
  if (data.version !== 1) throw new BackupError('Unsupported backup version; expected version 1')
  if (typeof data.createdAt !== 'number' || !Number.isFinite(data.createdAt) || data.createdAt < 0) {
    throw new BackupError('Backup createdAt must be a finite, non-negative timestamp')
  }
  if (!Array.isArray(data.tracks)) throw new BackupError('Backup tracks must be an array')
  if (!Object.hasOwn(data, 'settings') || data.settings === undefined) throw new BackupError('Backup settings is required')
  const optionalArray = (key: string): unknown[] => {
    if (data[key] === undefined) return []
    if (!Array.isArray(data[key])) throw new BackupError(`Backup ${key} must be an array`)
    return [...data[key]]
  }
  return {
    version: 1, createdAt: data.createdAt, tracks: [...data.tracks],
    playlists: optionalArray('playlists'), arrangements: optionalArray('arrangements'),
    settings: data.settings, bookmarks: optionalArray('bookmarks'),
  }
}

/** Supply createdAt for deterministic output; otherwise use the current time. */
export function buildManifest(parts: BackupParts): BackupManifest {
  return validate({ ...parts, createdAt: parts.createdAt ?? Date.now(), version: 1 })
}

export function parseManifest(json: string): BackupManifest {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new BackupError('Backup is not valid JSON')
  }
  return validate(value)
}

/** Preserve first-seen ID order; keep selects the first value, replace the last. */
export function mergeById<T extends { id: string }>(existing: T[], incoming: T[], strategy: 'keep' | 'replace'): T[] {
  const merged = new Map<string, T>()
  for (const item of [...existing, ...incoming]) {
    if (strategy === 'replace' || !merged.has(item.id)) merged.set(item.id, item)
  }
  return [...merged.values()]
}
