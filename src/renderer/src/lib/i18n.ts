/**
 * Minimal zero-dependency i18n: a flat key → Arabic dictionary with the
 * English literal kept at the call site as the fallback, so untranslated
 * strings degrade to English instead of breaking the UI.
 *
 * Convention: t('nav.home', 'Home') — namespaced keys (nav.*, page.*,
 * search.*, settings.* …) living in lib/locales/ar.ts (+ ar.extra.ts for
 * bulk page sweeps). The whole tree remounts on language change (keyed by
 * the setting in App.tsx), so t() can stay a plain module read.
 */
import { arCore } from './locales/ar'
import { arExtra } from './locales/ar.extra'

export type Lang = 'en' | 'ar'

const ar: Record<string, string> = { ...arCore, ...arExtra }

let lang: Lang = 'en'

/** Apply language + writing direction to <html>. Called from App's effect. */
export function setLang(l: Lang): void {
  lang = l === 'ar' ? 'ar' : 'en'
  const el = document.documentElement
  el.lang = lang
  el.dir = lang === 'ar' ? 'rtl' : 'ltr'
}

export function getLang(): Lang {
  return lang
}

/** Translate `key`; falls back to the English literal passed in. */
export function t(key: string, en: string): string {
  if (lang === 'ar') {
    const v = ar[key]
    if (v) return v
  }
  return en
}
