/**
 * Préférences côté renderer : copie de `prefs.json` (main fait foi), mises à jour optimistes,
 * application du thème (`<html data-theme>`) et du mouvement réduit.
 */
import { create } from 'zustand'
import type { UserPrefsPatch } from '../../../shared/ipc/prefs'
import { DEFAULT_PREFS, mergePrefs, type Prefs } from '../../../shared/prefs'
import { isNotImplemented, rpc, subscribe } from '../lib/rpc'

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

export function applyPrefsToDocument(
  prefs: Prefs,
  root: HTMLElement = document.documentElement,
): void {
  root.dataset.theme = effectiveTheme(prefs.theme)
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
      applyPrefsToDocument(prefs)
    } catch (err) {
      // Avant WP-02, `prefs.get` n'est pas implémenté : on garde les défauts.
      if (!isNotImplemented(err)) console.error('[prefs] lecture impossible', err)
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

/** Suit `evt:prefs.changed` (autre fenêtre, main). */
export function followPrefsChanges(): () => void {
  return subscribe('prefs.changed', (prefs) => {
    usePrefs.setState({ prefs, loaded: true })
    applyPrefsToDocument(prefs)
  })
}
