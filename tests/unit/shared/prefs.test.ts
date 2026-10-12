import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFS,
  PrefsSchema,
  mergePrefs,
  parsePrefsLenient,
} from '../../../src/shared/prefs'

describe('PrefsSchema', () => {
  it('parse({}) renvoie tous les défauts imbriqués (prefault)', () => {
    const p = PrefsSchema.parse({})
    expect(p).toEqual({
      version: 1,
      theme: 'system',
      defaultSort: 'recent',
      defaultColumns: 4,
      defaultMode: 'library',
      hoverPlay: true,
      reduceMotion: 'system',
      spacesWheel: 'scroll',
      videoMuted: false,
      trashAutoEmptyDays: 0,
      capture: {
        shortcut: 'CommandOrControl+Shift+S',
        shortcutLabel: 'S',
        mode: 'region',
        dropFolder: null,
        notify: true,
        hideApp: true,
        copyToClipboard: false,
        promptShown: false,
        dropFolderInit: false,
      },
      sync: { x: false, instagram: false, cosmos: false },
      ai: {
        provider: 'off',
        fallback: 'none',
        autoNameOnSave: true,
        autoAnalyzeOnSave: true,
        autoTag: false,
        maxAutoPerDay: 50,
        bulkThreshold: 20,
        perHour: 120,
        perDay: 600,
        hardPerDay: 1000,
        minGapMs: 5000,
        concurrency: 1,
        titlePolicy: 'empty',
        claude: {
          model: 'sonnet',
          effort: 'low',
          imageMode: 'read-tool',
          outputMode: 'stream-json',
          restricted: false,
        },
        codex: { effort: 'low' },
        lastSeenVersions: {},
      },
      tools: {},
      storage: { downloadRemoteMedia: true },
      ui: { language: 'system' },
    })
    expect(DEFAULT_PREFS).toEqual(p)
  })

  it('applique les défauts internes d’un sous-objet partiel', () => {
    const p = PrefsSchema.parse({ ai: { provider: 'claude' }, capture: { mode: 'window' } })
    expect(p.ai.provider).toBe('claude')
    expect(p.ai.claude.model).toBe('sonnet')
    expect(p.capture.shortcut).toBe('CommandOrControl+Shift+S')
    expect(p.capture.mode).toBe('window')
  })

  it('n’a ni secret partagé ni réglage de recherche visuelle', () => {
    const keys = JSON.stringify(PrefsSchema.parse({}))
    expect(keys).not.toMatch(/bridgeToken|semanticSearch|embeddingModel/)
  })

  it('refuse des colonnes hors 2..8 et un tri inconnu', () => {
    expect(PrefsSchema.safeParse({ defaultColumns: 9 }).success).toBe(false)
    expect(PrefsSchema.safeParse({ defaultColumns: 1 }).success).toBe(false)
    expect(PrefsSchema.safeParse({ defaultSort: 'size' }).success).toBe(false)
    expect(PrefsSchema.parse({ defaultSort: 'mostViewed' }).defaultSort).toBe('mostViewed')
  })

  it('mergePrefs fusionne en profondeur et revalide', () => {
    const p = mergePrefs(DEFAULT_PREFS, { ai: { claude: { model: 'opus' } }, theme: 'dark' })
    expect(p.ai.claude.model).toBe('opus')
    expect(p.ai.claude.effort).toBe('low')
    expect(p.theme).toBe('dark')
    expect(() => mergePrefs(DEFAULT_PREFS, { defaultColumns: 12 })).toThrow()
  })

  it('parsePrefsLenient retombe sur les défauts', () => {
    expect(parsePrefsLenient({ theme: 'violet' })).toEqual(DEFAULT_PREFS)
    expect(parsePrefsLenient({ theme: 'dark' }).theme).toBe('dark')
  })

  it('parsePrefsLenient répare champ par champ : une valeur hors bornes ne perd pas le reste', () => {
    const p = parsePrefsLenient({
      theme: 'dark',
      defaultColumns: 10,
      ai: { provider: 'claude', consentVersion: 2, consentAt: 1700000000000 },
      capture: { shortcut: 'CommandOrControl+Alt+X' },
    })
    expect(p.theme).toBe('dark')
    expect(p.defaultColumns).toBe(DEFAULT_PREFS.defaultColumns)
    expect(p.ai.provider).toBe('claude')
    expect(p.ai.consentVersion).toBe(2)
    expect(p.ai.consentAt).toBe(1700000000000)
    expect(p.capture.shortcut).toBe('CommandOrControl+Alt+X')
  })

  it('parsePrefsLenient : un sous-objet mal typé revient à son défaut sans toucher au reste', () => {
    const p = parsePrefsLenient({ theme: 'light', ai: 'off', defaultSort: 'name' })
    expect(p.ai).toEqual(DEFAULT_PREFS.ai)
    expect(p.theme).toBe('light')
    expect(p.defaultSort).toBe('name')
  })
})
