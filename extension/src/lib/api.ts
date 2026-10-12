/**
 * Access to the extension APIs for Chromium (`chrome.*`) and Firefox (`browser.*`), promise-only forms
 * (no polyfill). Firefox also exposes `chrome.*`, but only `browser.*`
 * returns promises everywhere.
 */
declare const browser: typeof chrome | undefined

/** Build target (`__RECOLTOS_TARGET__` replaced by esbuild). */
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

/** Error message of the last call (Chromium `runtime.lastError`). */
export function lastErrorMessage(): string | undefined {
  try {
    return api().runtime.lastError?.message
  } catch {
    return undefined
  }
}
