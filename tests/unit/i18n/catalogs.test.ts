/**
 * Catalogues FR / EN : mêmes clés et mêmes arités (renderer, main, extension), typographie
 * anglaise (pas d'espace insécable ni de guillemets français), détection de la langue du système.
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

/** Chemins des feuilles : `a.b.c` (string) ou `a.b.c()/2` (fonction et arité). */
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

/** Tous les textes d'un catalogue (fonctions appelées avec des arguments plausibles). */
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
/** Seules exceptions anglaises : le nom de la langue française dans le sélecteur. */
const ALLOWED_ACCENTED = new Set(['Français'])

describe('catalogues renderer', () => {
  it('anglais : exactement les clés et arités du français', () => {
    expect(shape(en)).toEqual(shape(fr))
  })
  it('anglais : typographie anglaise, aucun texte français', () => {
    const all = strings(en)
    expect(all.length).toBeGreaterThan(500)
    for (const s of all) {
      expect(s, s).not.toMatch(FRENCH_TYPO)
      if (!ALLOWED_ACCENTED.has(s)) expect(s, s).not.toMatch(ACCENTS)
    }
  })
  it('libellés clés en anglais (termes macOS)', () => {
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

describe('catalogues main et extension', () => {
  it('main : mêmes clés, anglais sans typographie française', () => {
    expect(shape(mainEn)).toEqual(shape(mainFr))
    for (const s of strings(mainEn)) {
      expect(s, s).not.toMatch(FRENCH_TYPO)
      expect(s, s).not.toMatch(ACCENTS)
    }
  })
  it('extension : mêmes clés, anglais sans typographie française', () => {
    expect(shape(extEn)).toEqual(shape(extFr))
    for (const s of strings(extEn)) {
      expect(s, s).not.toMatch(FRENCH_TYPO)
      expect(s, s).not.toMatch(ACCENTS)
    }
  })
})

describe('langue du système', () => {
  afterEach(() => setLang('fr'))

  it('français pour fr, fr-FR, fr-CA, fr_BE ; anglais pour tout le reste', () => {
    for (const l of ['fr', 'fr-FR', 'fr-CA', 'fr_BE', 'FR-ch']) expect(langFromLocale(l)).toBe('fr')
    for (const l of ['en', 'en-US', 'de-DE', 'es', 'frr', '', undefined, null]) {
      expect(langFromLocale(l)).toBe('en')
    }
  })
  it('la première langue préférée décide', () => {
    expect(langFromLocales(['fr-FR', 'en-US'])).toBe('fr')
    expect(langFromLocales(['en-GB', 'fr-FR'])).toBe('en')
    expect(langFromLocales(['', 'fr-CA'])).toBe('fr')
    expect(langFromLocales([])).toBe('en')
  })
  it('le réglage explicite prime sur le système', () => {
    expect(resolveLang('system', 'fr')).toBe('fr')
    expect(resolveLang('system', 'en')).toBe('en')
    expect(resolveLang('fr', 'en')).toBe('fr')
    expect(resolveLang('en', 'fr')).toBe('en')
    expect(resolveLang(undefined, 'en')).toBe('en')
  })
  it('validation et libellés partagés suivent la langue active', () => {
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

describe('langue active du renderer', () => {
  afterEach(() => setLang('fr'))

  it('`tr` suit setUiLang ; la bibliothèque par défaut non renommée suit la langue', async () => {
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
