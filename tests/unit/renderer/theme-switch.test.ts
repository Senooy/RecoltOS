/**
 * Instant theme switch: `data-theme-switching` disables transitions during the change frame,
 * then disappears; no marking when the theme does not change.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setDocumentTheme } from '../../../src/renderer/src/state/prefs'

const root = (theme?: string) =>
  ({ dataset: theme ? { theme } : {} }) as unknown as HTMLElement & {
    dataset: Record<string, string | undefined>
  }

describe('setDocumentTheme', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sets data-theme and removes data-theme-switching two frames later', () => {
    const frames: (() => void)[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb))
    const el = root('light')
    setDocumentTheme('dark', el)
    expect(el.dataset.theme).toBe('dark')
    expect(el.dataset.themeSwitching).toBe('1')
    frames.shift()?.()
    expect(el.dataset.themeSwitching).toBe('1')
    frames.shift()?.()
    expect(el.dataset.themeSwitching).toBeUndefined()
  })

  it('marks nothing when the theme is already the right one', () => {
    const el = root('dark')
    setDocumentTheme('dark', el)
    expect(el.dataset.themeSwitching).toBeUndefined()
  })
})
