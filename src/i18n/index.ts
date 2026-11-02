import { signal } from '@preact/signals'
import en from './en'

export type Locale = 'en' | 'es' | 'fr' | 'de'
const tables: Record<Locale, Record<string, string>> = { en, es: en, fr: en, de: en }
const loaded = new Set<Locale>(['en'])
const loaders: Record<Exclude<Locale, 'en'>, () => Promise<{ default: Record<string, string> }>> = { es: () => import('./es'), fr: () => import('./fr'), de: () => import('./de') }
/** Register a translation table (used by tests and by ensureLocale). */
export function registerLocale(code: Locale, table: Record<string, string>): void { tables[code] = table; loaded.add(code) }
/** Loads a locale's strings on demand (only English ships in the first bundle). */
export async function ensureLocale(code: Locale): Promise<void> {
  if (loaded.has(code) || code === 'en') return
  registerLocale(code, (await loaders[code]()).default)
}

export const locale = signal<Locale>('en')
const supported = (code: string): code is Locale => Object.hasOwn(tables, code)
const baseLocale = (code: string) => code.trim().toLowerCase().replaceAll('_', '-').split('-')[0] ?? ''

/** Explicit choices take priority; automatic mode follows the browser's preference order. */
export function resolveLocale(pref: 'auto' | string, navigatorLanguages: readonly string[]): Locale {
  for (const code of pref === 'auto' ? navigatorLanguages : [pref]) {
    const base = baseLocale(code)
    if (supported(base)) return base
  }
  return 'en'
}
export function setLocale(code: string): void { locale.value = resolveLocale(code, []) }
/** Load then apply: avoids a flash of English when starting in another language. */
export async function setLocaleAsync(code: string): Promise<void> { const l = resolveLocale(code, []); await ensureLocale(l); locale.value = l }
export function getLocale(): Locale { return locale.value }

/** Reading the signal here subscribes the rendering component to language changes. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const code = locale.value
  const table = tables[code]
  const count = vars?.count
  const pluralKey = typeof count === 'number'
    ? `${key}_${new Intl.PluralRules(code).select(count) === 'one' ? 'one' : 'other'}`
    : key
  const own = (source: Record<string, string>, k: string) => Object.hasOwn(source, k) ? source[k] : undefined
  const value = own(table, pluralKey) ?? own(table, key) ?? own(en, pluralKey) ?? own(en, key) ?? key
  return value.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    vars && Object.hasOwn(vars, name) ? String(vars[name]) : placeholder)
}
