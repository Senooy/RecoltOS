/**
 * Bascule de thème instantanée (WP-70) : `data-theme-switching` coupe les transitions pendant
 * l'image du changement, puis disparaît ; aucun marquage quand le thème ne change pas.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setDocumentTheme } from '../../../src/renderer/src/state/prefs'

const root = (theme?: string) =>
  ({ dataset: theme ? { theme } : {} }) as unknown as HTMLElement & {
    dataset: Record<string, string | undefined>
  }

describe('setDocumentTheme', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('pose data-theme et retire data-theme-switching deux images plus tard', () => {
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

  it('ne marque rien quand le thème est déjà le bon', () => {
    const el = root('dark')
    setDocumentTheme('dark', el)
    expect(el.dataset.themeSwitching).toBeUndefined()
  })
})
