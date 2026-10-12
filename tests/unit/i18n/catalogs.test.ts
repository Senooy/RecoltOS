/**
 * FR / EN catalogs: same keys and arities (renderer, main, extension), English
 * typography (no non-breaking space nor French quotes), system language detection.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { extEn, extFr } from '../../../extension/src/lib/i18n'
import { mainEn } from '../../../src/main/i18n/en'
import { mainFr } from '../../../src/main/i18n/fr'
import { en } from '../../../src/renderer/src/i18n/en'
import { fr } from '../../../src/renderer/src/i18n/fr'
import {
  getLang,
  langFromLocale,
  langFromLocales,
  resolveLang,
  setLang,
} from '../../../src/shared/i18n/lang'
import { formatIssues } from '../../../src/shared/errors'
import { Accelerator } from '../../../src/shared/accelerator'
import { displayShortcutLabel } from '../../../src/shared/shortcuts'

/** Leaf paths: `a.b.c` (string) or `a.b.c()/2` (function and arity). */
function shape(v: unknown, prefix = ''): string[] {
  if (typeof v === 'function') return [`${prefix}()/${v.length}`]
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.entries(v)
      .flatMap(([k, x]) => shape(x, prefix ? `${prefix}.${k}` : k))
      .sort()
  }
  if (Array.isArray(v)) return [`${prefix}[${v.length}]`]
  return [prefix]
}

/** All texts of a catalog (functions called with plausible arguments). */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (typeof v === 'function') {
    const r: unknown = (v as (...a: unknown[]) => unknown)(2, 3, 'x', 4)
    if (typeof r === 'string') out.push(r)
  } else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}

const FRENCH_TYPO = /[\u202f\u00a0]|[«»]| [:;?!](\s|$)/
const ACCENTS = /[àâçéèêëîïôûùœ]/i
/** Only English exceptions: the name of the French language in the selector. */
const ALLOWED_ACCENTED = new Set(['Français'])

describe('renderer catalogs', () => {
  it('English: exactly the keys and arities of French', () => {
    expect(shape(en)).toEqual(shape(fr))
  })
  it('English: English typography, no French text', () => {
    const all = strings(en)
    expect(all.length).toBeGreaterThan(500)
    for (const s of all) {
      expect(s, s).not.toMatch(FRENCH_TYPO)
      if (!ALLOWED_ACCENTED.has(s)) expect(s, s).not.toMatch(ACCENTS)
    }
  })
  it('key labels in English (macOS terms)', () => {
    expect(en.nav.library).toBe('Library')
    expect(en.nav.settings).toBe('Settings')
    expect(en.tabs.trash).toBe('Trash')
    expect(en.tabs.hidden).toBe('Hidden')
    expect(en.nav.rediscover).toBe('Rediscover')
    expect(en.count.items(1)).toBe('1 item')
    expect(en.count.items(0)).toBe('0 items')
    expect(en.count.items(36)).toBe('36 items')
    expect(en.settings.appearance.languageSystem).toBe('Automatic (Mac language)')
    expect(fr.settings.appearance.languageSystem).toBe('Automatique (langue du Mac)')
  })
})

describe('main and extension catalogs', () => {
  it('main: same keys, English without French typography', () => {
    expect(shape(mainEn)).toEqual(shape(mainFr))
    for (const s of strings(mainEn)) {
      expect(s, s).not.toMatch(FRENCH_TYPO)
      expect(s, s).not.toMatch(ACCENTS)
    }
  })
  it('extension: same keys, English without French typography', () => {
    expect(shape(extEn)).toEqual(shape(extFr))
    for (const s of strings(extEn)) {
      expect(s, s).not.toMatch(FRENCH_TYPO)
      expect(s, s).not.toMatch(ACCENTS)
    }
  })
})

describe('system language', () => {
  afterEach(() => setLang('fr'))

  it('French for fr, fr-FR, fr-CA, fr_BE; English for everything else', () => {
    for (const l of ['fr', 'fr-FR', 'fr-CA', 'fr_BE', 'FR-ch']) expect(langFromLocale(l)).toBe('fr')
    for (const l of ['en', 'en-US', 'de-DE', 'es', 'frr', '', undefined, null]) {
      expect(langFromLocale(l)).toBe('en')
    }
  })
  it('the first preferred language decides', () => {
    expect(langFromLocales(['fr-FR', 'en-US'])).toBe('fr')
    expect(langFromLocales(['en-GB', 'fr-FR'])).toBe('en')
    expect(langFromLocales(['', 'fr-CA'])).toBe('fr')
    expect(langFromLocales([])).toBe('en')
  })
  it('the explicit setting takes precedence over the system', () => {
    expect(resolveLang('system', 'fr')).toBe('fr')
    expect(resolveLang('system', 'en')).toBe('en')
    expect(resolveLang('fr', 'en')).toBe('fr')
    expect(resolveLang('en', 'fr')).toBe('en')
    expect(resolveLang(undefined, 'en')).toBe('en')
  })
  it('shared validation and labels follow the active language', () => {
    expect(getLang()).toBe('fr')
    expect(formatIssues([])).toBe('Entrée invalide')
    expect(displayShortcutLabel('Échap')).toBe('Échap')
    const frMsg = Accelerator.safeParse('S').error?.issues[0]?.message
    expect(frMsg).toMatch(/raccourci attendu/)
    setLang('en')
    expect(formatIssues([])).toBe('Invalid input')
    expect(formatIssues([{ message: 'Too long', path: ['a', 'b'] }])).toBe('Too long (field a.b)')
    expect(displayShortcutLabel('Échap')).toBe('Esc')
    expect(displayShortcutLabel('⌘K')).toBe('⌘K')
    expect(Accelerator.safeParse('S').error?.issues[0]?.message).toMatch(/expected shortcut/)
  })
})

describe('renderer active language', () => {
  afterEach(() => setLang('fr'))

  it('`tr` follows setUiLang; the default unrenamed library follows the language', async () => {
    const i18n = await import('../../../src/renderer/src/i18n')
    const { setUiLang, libraryDisplayName } = i18n
    expect(i18n.tr.nav.library).toBe('Bibliothèque')
    setUiLang('en')
    expect(i18n.tr.nav.library).toBe('Library')
    expect(libraryDisplayName({ id: 'default', name: 'Bibliothèque' })).toBe('Library')
    expect(libraryDisplayName({ id: 'default', name: 'Mes images' })).toBe('Mes images')
    expect(libraryDisplayName({ id: 'x', name: 'Library' })).toBe('Library')
    setUiLang('fr')
    expect(libraryDisplayName({ id: 'default', name: 'Library' })).toBe('Bibliothèque')
  })
})
