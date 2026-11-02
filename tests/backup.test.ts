import { describe, expect, it } from 'vitest'
import { BackupError, buildManifest, mergeById, parseManifest } from '../src/library/backup'

const parts = { createdAt: 123, tracks: [{ id: 'a' }], settings: { volume: 0.5 } }

describe('backup manifests', () => {
  it('builds and round-trips all collections', () => {
    const full = { ...parts, playlists: [{ id: 'p' }], arrangements: [null], bookmarks: [{ time: 10 }] }
    const manifest = buildManifest(full)
    expect(manifest).toEqual({ ...full, version: 1 })
    expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest)
    expect(manifest.tracks).not.toBe(parts.tracks)
  })
  it('defaults optional arrays and drops unknown top-level keys', () => {
    expect(parseManifest(JSON.stringify({ ...parts, version: 1, extra: true }))).toEqual({
      ...parts, version: 1, playlists: [], arrangements: [], bookmarks: [],
    })
    const before = Date.now()
    const manifest = buildManifest({ tracks: [], settings: null })
    expect(manifest.createdAt).toBeGreaterThanOrEqual(before)
    expect(manifest.createdAt).toBeLessThanOrEqual(Date.now())
    expect(manifest.settings).toBeNull()
  })
  it('reports malformed JSON with a BackupError', () => {
    expect(() => parseManifest('{')).toThrow(BackupError)
    expect(() => parseManifest('{')).toThrow('valid JSON')
  })
  it.each([null, [], 1, 'text'])('rejects non-object roots %j', value => {
    expect(() => parseManifest(JSON.stringify(value))).toThrow('must be an object')
  })
  it.each([
    [{ version: 2 }, 'version'], [{ version: '1' }, 'version'],
    [{ createdAt: -1 }, 'createdAt'], [{ createdAt: 'today' }, 'createdAt'],
    [{ tracks: {} }, 'tracks'], [{ tracks: null }, 'tracks'],
    [{ playlists: null }, 'playlists'], [{ arrangements: {} }, 'arrangements'], [{ bookmarks: '' }, 'bookmarks'],
  ])('rejects invalid shape %j', (patch, message) => {
    expect(() => parseManifest(JSON.stringify({ ...parts, version: 1, ...patch }))).toThrow(message)
  })
  it('requires tracks and settings and rejects non-finite build timestamps', () => {
    expect(() => parseManifest('{"version":1,"createdAt":0,"settings":{}}')).toThrow('tracks')
    expect(() => parseManifest('{"version":1,"createdAt":0,"tracks":[]}')).toThrow('settings')
    expect(() => buildManifest({ ...parts, createdAt: NaN })).toThrow(BackupError)
  })
})

describe('mergeById', () => {
  const existing = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }]
  const incoming = [{ id: 'b', value: 3 }, { id: 'c', value: 4 }, { id: 'c', value: 5 }]
  it('keeps first values and stable order without mutating inputs', () => {
    const snapshot = JSON.stringify([existing, incoming])
    expect(mergeById(existing, incoming, 'keep')).toEqual([...existing, incoming[1]])
    expect(JSON.stringify([existing, incoming])).toBe(snapshot)
  })
  it('replaces with last values while preserving existing positions', () => {
    expect(mergeById(existing, incoming, 'replace')).toEqual([existing[0], incoming[0], incoming[2]])
  })
  it('handles empty arrays, duplicate existing IDs and special property names', () => {
    expect(mergeById([], [], 'keep')).toEqual([])
    const values = [{ id: '__proto__', value: 1 }, { id: '__proto__', value: 2 }]
    expect(mergeById(values, [], 'keep')).toEqual([values[0]])
    expect(mergeById(values, [], 'replace')).toEqual([values[1]])
  })
})
