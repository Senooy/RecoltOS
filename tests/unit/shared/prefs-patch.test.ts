import { describe, expect, it } from 'vitest'
import { contract } from '../../../src/shared/ipc'
import { DEFAULT_PREFS, mergePrefs } from '../../../src/shared/prefs'

const input = contract['prefs.set'].input
const ok = (patch: unknown) => input.safeParse({ patch }).success

describe('prefs.set : patch strict', () => {
  it('accepte des patchs partiels valides, sans réécrire les autres réglages', () => {
    expect(ok({})).toBe(true)
    expect(ok({ theme: 'dark' })).toBe(true)
    expect(ok({ capture: { notify: false } })).toBe(true)
    expect(ok({ capture: { dropFolder: null } })).toBe(true)
    expect(ok({ ai: { provider: 'claude', claude: { model: 'opus' } } })).toBe(true)
    const parsed = input.parse({ patch: { capture: { notify: false } } })
    expect(parsed).toEqual({ patch: { capture: { notify: false } } })
    const merged = mergePrefs({ ...DEFAULT_PREFS, theme: 'dark' }, parsed.patch)
    expect(merged.theme).toBe('dark')
    expect(merged.capture.notify).toBe(false)
  })

  it('rejette les réglages réservés (consentement, versions, outils, version)', () => {
    expect(ok({ ai: { consentVersion: 3 } })).toBe(false)
    expect(ok({ ai: { consentAt: 1 } })).toBe(false)
    expect(ok({ ai: { provider: 'claude', consentVersion: 3 } })).toBe(false)
    expect(ok({ ai: { lastSeenVersions: { claude: '1.0.0' } } })).toBe(false)
    expect(ok({ tools: { claude: '/bin/sh' } })).toBe(false)
    expect(ok({ tools: {} })).toBe(false)
    expect(ok({ version: 1 })).toBe(false)
  })

  it('dropFolder doit être absolu ; model ne peut pas ressembler à une option de CLI', () => {
    expect(ok({ capture: { dropFolder: '../../x' } })).toBe(false)
    expect(ok({ capture: { dropFolder: '/Users/me/Bureau' } })).toBe(true)
    expect(ok({ ai: { claude: { model: '--dangerously-skip-permissions' } } })).toBe(false)
    expect(ok({ ai: { codex: { model: '-x' } } })).toBe(false)
    expect(ok({ ai: { claude: { model: 'claude-opus-4-1' } } })).toBe(true)
  })

  it('shortcut : un modificateur et une touche, sans raccourci système', () => {
    expect(ok({ capture: { shortcut: 'Command+Q' } })).toBe(false)
    expect(ok({ capture: { shortcut: 'CommandOrControl+W' } })).toBe(false)
    expect(ok({ capture: { shortcut: 'S' } })).toBe(false)
    expect(ok({ capture: { shortcut: 'CommandOrControl+Shift+S' } })).toBe(true)
    expect(ok({ capture: { shortcut: 'CommandOrControl+Alt+X' } })).toBe(true)
    // `capture.setShortcut` valide dans le handler (`reserved` / `invalid` dans le résultat, WP-33).
    expect(
      contract['capture.setShortcut'].input.safeParse({ accel: 'Command+Q', label: 'Q' }).success,
    ).toBe(true)
  })

  it('rejette les clés inconnues à tous les niveaux et les mauvais types', () => {
    expect(ok({ thme: 'dark' })).toBe(false)
    expect(ok({ capture: { notifyy: true } })).toBe(false)
    expect(ok({ ai: { claude: { modle: 'x' } } })).toBe(false)
    expect(ok({ theme: 'sepia' })).toBe(false)
    expect(ok({ defaultColumns: 12 })).toBe(false)
    expect(ok([])).toBe(false)
    expect(ok(null)).toBe(false)
  })
})
