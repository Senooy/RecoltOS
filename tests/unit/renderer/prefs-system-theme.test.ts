import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS, type Prefs } from '../../../src/shared/prefs'
import { followSystemTheme } from '../../../src/renderer/src/state/prefs'

function fakeMedia(initialDark: boolean) {
  let dark = initialDark
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', () => ({ matches: dark }))
  return {
    mql: {
      addEventListener: (_t: 'change', l: () => void) => void listeners.add(l),
      removeEventListener: (_t: 'change', l: () => void) => void listeners.delete(l),
    },
    set(next: boolean) {
      dark = next
      for (const l of [...listeners]) l()
    },
    count: () => listeners.size,
  }
}

const root = () => ({ dataset: {} as Record<string, string> }) as unknown as HTMLElement

describe('« system » theme: follows the appearance change', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reapplies data-theme when the media query changes', () => {
    const m = fakeMedia(true)
    const el = root()
    const prefs: Prefs = { ...DEFAULT_PREFS, theme: 'system' }
    const stop = followSystemTheme(() => prefs, m.mql, el)
    m.set(false)
    expect(el.dataset.theme).toBe('light')
    m.set(true)
    expect(el.dataset.theme).toBe('dark')
    stop()
    expect(m.count()).toBe(0)
  })

  it('leaves everything alone when the theme is forced', () => {
    const m = fakeMedia(true)
    const el = root()
    const prefs: Prefs = { ...DEFAULT_PREFS, theme: 'dark' }
    followSystemTheme(() => prefs, m.mql, el)
    m.set(false)
    expect(el.dataset.theme).toBeUndefined()
  })
})
