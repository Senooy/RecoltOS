/**
 * Native menu in both languages (same identifiers and shortcuts) and the `ui.language` setting
 * (default `system`, repair of an invalid value, accepted patch).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: true, getName: () => 'RecoltOS' }, Menu: {} }))

import type { MenuItemConstructorOptions } from 'electron'
import { buildMenuTemplate } from '../../../src/main/menu'
import { contract } from '../../../src/shared/ipc'
import { DEFAULT_PREFS, mergePrefs, parsePrefsLenient } from '../../../src/shared/prefs'

type Item = MenuItemConstructorOptions
const flat = (items: Item[]): Item[] =>
  items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu) : [])])

describe('native menu', () => {
  const fr = flat(buildMenuTemplate(() => undefined, 'RecoltOS', {}, 'fr'))
  const en = flat(buildMenuTemplate(() => undefined, 'RecoltOS', {}, 'en'))
  const label = (items: Item[], id: string) => items.find((i) => i.id === id)?.label

  it('same entries, same identifiers and shortcuts in both languages', () => {
    expect(en.map((i) => [i.id, i.role, i.accelerator, i.type])).toEqual(
      fr.map((i) => [i.id, i.role, i.accelerator, i.type]),
    )
  })
  it('standard macOS English labels', () => {
    expect(label(en, 'settings')).toBe('Settings…')
    expect(label(en, 'goLibrary')).toBe('Library')
    expect(label(en, 'rediscover')).toBe('Rediscover')
    expect(label(en, 'importGatheros')).toBe('Import from GatherOS…')
    expect(en.find((i) => i.role === 'quit')?.label).toBe('Quit RecoltOS')
    expect(en.map((i) => i.label).filter(Boolean)).toContain('Edit')
    expect(label(fr, 'settings')).toBe('Réglages…')
    expect(fr.map((i) => i.label).filter(Boolean)).toContain('Édition')
  })
  it('no English label contains French', () => {
    for (const l of en.map((i) => i.label).filter((x): x is string => !!x)) {
      expect(l, l).not.toMatch(/[àâçéèêëîïôûùœ]/i)
    }
  })
})

describe('ui.language setting', () => {
  it('default "system", values fr / en, invalid value repaired', () => {
    expect(DEFAULT_PREFS.ui.language).toBe('system')
    expect(mergePrefs(DEFAULT_PREFS, { ui: { language: 'en' } }).ui.language).toBe('en')
    expect(parsePrefsLenient({ theme: 'dark', ui: { language: 'de' } })).toMatchObject({
      theme: 'dark',
      ui: { language: 'system' },
    })
    expect(parsePrefsLenient({ ui: 'x' }).ui.language).toBe('system')
  })
  it('prefs.set patch accepted from the renderer, unknown value refused', () => {
    const input = contract['prefs.set'].input
    expect(input.safeParse({ patch: { ui: { language: 'fr' } } }).success).toBe(true)
    expect(input.safeParse({ patch: { ui: { language: 'system' } } }).success).toBe(true)
    expect(input.safeParse({ patch: { ui: { language: 'de' } } }).success).toBe(false)
    expect(input.safeParse({ patch: { ui: { other: 1 } } }).success).toBe(false)
  })
})
