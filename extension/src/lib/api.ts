/**
 * Accès aux API d'extension pour Chromium (`chrome.*`) et Firefox (`browser.*`), formes à promesses
 * uniquement (pas de polyfill). Firefox expose aussi `chrome.*` mais seul `browser.*`
 * renvoie des promesses partout.
 */
declare const browser: typeof chrome | undefined

/** Cible du build (`__RECOLTOS_TARGET__` remplacé par esbuild). */
declare const __RECOLTOS_TARGET__: 'chromium' | 'firefox'

export const TARGET: 'chromium' | 'firefox' =
  typeof __RECOLTOS_TARGET__ === 'string' ? __RECOLTOS_TARGET__ : 'chromium'

export const IS_FIREFOX = TARGET === 'firefox'

export function api(): typeof chrome {
  const g = globalThis as { browser?: typeof chrome; chrome?: typeof chrome }
  return (
    (typeof browser !== 'undefined' ? browser : undefined) ??
    g.browser ??
    (g.chrome as typeof chrome)
  )
}

/** Message d'erreur du dernier appel (Chromium `runtime.lastError`). */
export function lastErrorMessage(): string | undefined {
  try {
    return api().runtime.lastError?.message
  } catch {
    return undefined
  }
}
