import { describe, expect, it } from 'vitest'
import { contract } from '../../../src/shared/ipc'
import { DEFAULT_PREFS, mergePrefs } from '../../../src/shared/prefs'

const input = contract['prefs.set'].input
const ok = (patch: unknown) => input.safeParse({ patch }).success

describe('prefs.set: strict patch', () => {
  it('accepts valid partial patches, without rewriting the other settings', () => {
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

  it('rejects reserved settings (consent, versions, tools, version)', () => {
    expect(ok({ ai: { consentVersion: 3 } })).toBe(false)
    expect(ok({ ai: { consentAt: 1 } })).toBe(false)
    expect(ok({ ai: { provider: 'claude', consentVersion: 3 } })).toBe(false)
    expect(ok({ ai: { lastSeenVersions: { claude: '1.0.0' } } })).toBe(false)
    expect(ok({ tools: { claude: '/bin/sh' } })).toBe(false)
    expect(ok({ tools: {} })).toBe(false)
    expect(ok({ version: 1 })).toBe(false)
  })

  it('dropFolder must be absolute; model cannot look like a CLI option', () => {
    expect(ok({ capture: { dropFolder: '../../x' } })).toBe(false)
    expect(ok({ capture: { dropFolder: '/Users/me/Bureau' } })).toBe(true)
    expect(ok({ ai: { claude: { model: '--dangerously-skip-permissions' } } })).toBe(false)
    expect(ok({ ai: { codex: { model: '-x' } } })).toBe(false)
    expect(ok({ ai: { claude: { model: 'claude-opus-4-1' } } })).toBe(true)
  })

  it('shortcut: one modifier and one key, no system shortcut', () => {
    expect(ok({ capture: { shortcut: 'Command+Q' } })).toBe(false)
    expect(ok({ capture: { shortcut: 'CommandOrControl+W' } })).toBe(false)
    expect(ok({ capture: { shortcut: 'S' } })).toBe(false)
    expect(ok({ capture: { shortcut: 'CommandOrControl+Shift+S' } })).toBe(true)
    expect(ok({ capture: { shortcut: 'CommandOrControl+Alt+X' } })).toBe(true)
    // `capture.setShortcut` validates in the handler (`reserved` / `invalid` in the result).
    expect(
      contract['capture.setShortcut'].input.safeParse({ accel: 'Command+Q', label: 'Q' }).success,
    ).toBe(true)
  })

  it('rejects unknown keys at all levels and wrong types', () => {
    expect(ok({ thme: 'dark' })).toBe(false)
    expect(ok({ capture: { notifyy: true } })).toBe(false)
    expect(ok({ ai: { claude: { modle: 'x' } } })).toBe(false)
    expect(ok({ theme: 'sepia' })).toBe(false)
    expect(ok({ defaultColumns: 12 })).toBe(false)
    expect(ok([])).toBe(false)
    expect(ok(null)).toBe(false)
  })
})
