import { signal } from '@preact/signals'
import en from './en'
import es from './es'
import fr from './fr'
import de from './de'

export type Locale = 'en' | 'es' | 'fr' | 'de'
const tables: Record<Locale, Record<string, string>> = { en, es, fr, de }
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
