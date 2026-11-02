import { afterEach, describe, expect, it, vi } from 'vitest'
import { effect } from '@preact/signals'
import { readFileSync, readdirSync } from 'node:fs'
import en from '../src/i18n/en'
import es from '../src/i18n/es'
import fr from '../src/i18n/fr'
import de from '../src/i18n/de'
import { getLocale, locale, resolveLocale, setLocale, t } from '../src/i18n'

const stored = vi.hoisted(() => new Map<string, unknown>())
vi.mock('idb-keyval', () => ({
  createStore: () => ({}),
  get: async (key: string) => stored.get(key),
  set: async (key: string, value: unknown) => { stored.set(key, value) },
}))
import { defaultSettings, loadSettings, saveSettings } from '../src/library/store'

const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
afterEach(() => setLocale('en'))

describe('locale tables', () => {
  for (const [code, table] of Object.entries({ en, es, fr, de })) {
    it(`${code} contains every English key, nonempty values and identical placeholders`, () => {
      expect(Object.keys(table).sort()).toEqual(Object.keys(en).sort())
      for (const [key, value] of Object.entries(en)) {
        expect(table[key]?.trim(), `${code}: ${key}`).toBeTruthy()
        expect(placeholders(table[key]!), `${code}: ${key}`).toEqual(placeholders(value))
      }
    })
  }
  it('contains the literal translation keys used in UI and state', () => {
    const paths = readdirSync('src/ui').filter(f => f.endsWith('.tsx')).map(f => `src/ui/${f}`).concat('src/state.ts')
    for (const path of paths) {
      const source = readFileSync(path, 'utf8')
      for (const match of source.matchAll(/translate\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) {
        const key = match[1]!.slice(1, -1)
        expect(Object.hasOwn(en, key) || Object.hasOwn(en, `${key}_one`), `${path}: ${key}`).toBe(true)
      }
    }
  })
})

describe('resolveLocale', () => {
  it.each([
    ['auto', ['es-MX', 'en-US'], 'es'],
    ['auto', ['pt-BR', 'fr-CA', 'de-DE'], 'fr'],
    ['auto', ['ja', 'de-AT'], 'de'],
    ['auto', ['en-GB', 'fr'], 'en'],
    ['auto', ['xx', 'zh-Hant'], 'en'],
    ['auto', [], 'en'],
    ['auto', [' ES_mx '], 'es'],
    ['fr', ['de'], 'fr'],
    ['DE-ch', ['es'], 'de'],
    ['es', [], 'es'],
    ['pt', ['fr'], 'en'],
    ['', ['de'], 'en'],
    ['constructor', ['fr'], 'en'],
  ] as const)('%s with %j resolves to %s', (pref, languages, expected) => {
    expect(resolveLocale(pref, languages)).toBe(expected)
  })
})

describe('translation', () => {
  it('sets, normalizes and reads the reactive locale', () => {
    expect(locale.value).toBe('en')
    setLocale('FR-ca')
    expect(getLocale()).toBe('fr')
    expect(locale.value).toBe('fr')
    setLocale('unsupported')
    expect(getLocale()).toBe('en')
  })
  it('reactively updates translations when the language changes', () => {
    const seen: string[] = []
    const dispose = effect(() => { seen.push(t('Library')) })
    try {
      setLocale('es'); setLocale('de')
      expect(seen).toEqual(['Library', 'Biblioteca', 'Mediathek'])
    } finally { dispose() }
  })
  it('interpolates strings and numbers without interpreting their contents', () => {
    expect(t('Added to {name}', { name: '$& {count}' })).toBe('Added to $& {count}')
    expect(t('Crossfade {value}', { value: 0 })).toBe('Crossfade 0')
    expect(t('Added to {name}', { name: '' })).toBe('Added to ')
    expect(t('Added to {name}')).toBe('Added to {name}')
    expect(t('Added to {name}', { other: 1 })).toBe('Added to {name}')
  })
  it.each([
    ['en', 0, '0 songs'], ['en', 1, '1 song'], ['en', 2, '2 songs'],
    ['en', 1.5, '1.5 songs'], ['es', 1, '1 canción'], ['es', 2, '2 canciones'],
    ['fr', 0, '0 morceau'], ['fr', 1, '1 morceau'], ['fr', 2, '2 morceaux'],
    ['de', 1, '1 Song'], ['de', 2, '2 Songs'],
  ] as const)('selects plurals for %s, count %s', (code, count, expected) => {
    setLocale(code)
    expect(t('songCount', { count })).toBe(expected)
  })
  it('keeps the original English import and scrobble messages', () => {
    expect(t('addedTracks', { count: 1 })).toBe('Added 1 track')
    expect(t('addedTracks', { count: 3 })).toBe('Added 3 tracks')
    expect(t('sendScrobbles', { count: 1 })).toBe('Send 1 queued scrobble now')
    expect(t('sendScrobbles', { count: 3 })).toBe('Send 3 queued scrobbles now')
    expect(t('addedStations', { count: 1 })).toBe('Added 1 station')
  })
  it('falls back to English, including the English plural, then to the key', () => {
    const saved = es.Library, plural = es.songCount_other
    try {
      delete es.Library; delete es.songCount_other
      setLocale('es')
      expect(t('Library')).toBe('Library')
      expect(t('songCount', { count: 4 })).toBe('4 songs')
      expect(t('missing.key')).toBe('missing.key')
      expect(t('missing {name}', { name: 'Alex' })).toBe('missing Alex')
    } finally { es.Library = saved!; es.songCount_other = plural! }
  })
  it('does not use inherited object properties as translations or variables', () => {
    expect(t('toString')).toBe('toString')
    expect(t('__proto__')).toBe('__proto__')
    expect(t('{constructor}', {})).toBe('{constructor}')
  })
})


describe('saved language preference', () => {
  afterEach(() => stored.clear())
  it('defaults new and older settings to automatic language selection', async () => {
    expect(defaultSettings.language).toBe('auto')
    expect((await loadSettings()).language).toBe('auto')
    stored.set('settings', { crossfade: 3 })
    const settings = await loadSettings()
    expect(settings.language).toBe('auto')
    expect(settings.crossfade).toBe(3)
  })
  it('persists an explicit language alongside existing settings', async () => {
    await saveSettings({ ...defaultSettings, language: 'de', crossfade: 5 })
    const settings = await loadSettings()
    expect(settings.language).toBe('de')
    expect(settings.crossfade).toBe(5)
  })
})
