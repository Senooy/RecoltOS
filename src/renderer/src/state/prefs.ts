/**
 * Renderer-side preferences: copy of `prefs.json` (main is authoritative), optimistic updates,
 * applying the theme (`<html data-theme>`), reduced motion and language (`ui.language`).
 */
import { create } from 'zustand'
import type { UserPrefsPatch } from '../../../shared/ipc/prefs'
import { DEFAULT_PREFS, mergePrefs, type Prefs } from '../../../shared/prefs'
import { resolveLang, type Lang } from '../../../shared/i18n/lang'
import { getUiLang, setUiLang } from '../i18n'
import { isNotImplemented, rpc, subscribe } from '../lib/rpc'
import { transitionTheme } from '../lib/theme-transition'

export interface PrefsState {
  prefs: Prefs
  loaded: boolean
  load(): Promise<void>
  update(patch: UserPrefsPatch): Promise<void>
}

export function effectiveTheme(theme: Prefs['theme']): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

/**
 * INSTANT theme switch: during the frame where `data-theme` changes, `data-theme-switching`
 * disables all transitions (otherwise surfaces animated over 120 ms pass through a mixed state
 * of both themes, perceived as a flash). Removed two frames later.
 */
export function setDocumentTheme(
  theme: 'light' | 'dark',
  root: HTMLElement = document.documentElement,
): void {
  if (root.dataset.theme === theme) return
  root.dataset.themeSwitching = '1'
  root.dataset.theme = theme
  const raf =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 16)
  raf(() => raf(() => delete root.dataset.themeSwitching))
}

/**
 * System language as seen by the renderer: passed by main at launch (`flags.systemLang`).
 * Without flags (tests), the current language: `ui.language: 'system'` then does not change it.
 */
export function systemLang(): Lang {
  return (
    (typeof window !== 'undefined' ? window.recolt?.flags.systemLang : undefined) ?? getUiLang()
  )
}

/** Effective language from the prefs, applied immediately (the shell re-renders in that language). */
export function applyPrefsLanguage(prefs: Prefs): void {
  setUiLang(resolveLang(prefs.ui.language, systemLang()))
}

/**
 * Theme change seen by the user: spreads from the control that asked for it and resonates
 * (`lib/theme-transition.ts`), or instant (`setDocumentTheme`) with reduced motion, in e2e mode,
 * when `animate` is false (first read of the prefs) or without View Transitions.
 */
export function showDocumentTheme(
  theme: 'light' | 'dark',
  root: HTMLElement = document.documentElement,
  animate = true,
): void {
  transitionTheme(theme, root, () => setDocumentTheme(theme, root), animate)
}

export function applyPrefsToDocument(
  prefs: Prefs,
  root: HTMLElement = document.documentElement,
  animate = true,
): void {
  applyPrefsLanguage(prefs)
  showDocumentTheme(effectiveTheme(prefs.theme), root, animate)
  if (prefs.reduceMotion === 'always') root.dataset.reduceMotion = '1'
  else delete root.dataset.reduceMotion
}

export const usePrefs = create<PrefsState>()((set, get) => ({
  prefs: DEFAULT_PREFS,
  loaded: false,
  async load() {
    try {
      const prefs = await rpc('prefs.get')
      set({ prefs, loaded: true })
      applyPrefsToDocument(prefs, document.documentElement, false)
    } catch (err) {
      // Older builds lack `prefs.get`: keep the defaults.
      if (!isNotImplemented(err)) console.error('[prefs] cannot read', err)
      set({ loaded: true })
    }
  },
  async update(patch) {
    const before = get().prefs
    const optimistic = mergePrefs(before, patch)
    set({ prefs: optimistic })
    applyPrefsToDocument(optimistic)
    try {
      const saved = await rpc('prefs.set', { patch })
      set({ prefs: saved })
      applyPrefsToDocument(saved)
    } catch (err) {
      set({ prefs: before })
      applyPrefsToDocument(before)
      throw err
    }
  },
}))

export interface SystemThemeQuery {
  addEventListener(type: 'change', listener: () => void): void
  removeEventListener(type: 'change', listener: () => void): void
}

/**
 * With `theme: 'system'`, reapplies the theme when the system appearance changes
 * (automatic macOS switch); no effect for `light` / `dark`.
 */
export function followSystemTheme(
  getPrefs: () => Prefs = () => usePrefs.getState().prefs,
  mql: SystemThemeQuery | null = typeof matchMedia === 'function'
    ? matchMedia('(prefers-color-scheme: dark)')
    : null,
  root: HTMLElement = document.documentElement,
): () => void {
  if (!mql) return () => undefined
  const onChange = () => {
    const prefs = getPrefs()
    if (prefs.theme === 'system') applyPrefsToDocument(prefs, root)
  }
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

/** Follows `evt:prefs.changed` (another window, main) and the system appearance. */
export function followPrefsChanges(): () => void {
  const stopSystem = followSystemTheme()
  const stopEvent = subscribe('prefs.changed', (prefs) => {
    usePrefs.setState({ prefs, loaded: true })
    applyPrefsToDocument(prefs)
  })
  return () => {
    stopSystem()
    stopEvent()
  }
}
