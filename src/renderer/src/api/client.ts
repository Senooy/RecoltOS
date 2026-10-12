/**
 * Access to `window.recolt` (preload). Outside Electron (browser) or with `?mock` in dev,
 * the mock API (`mock.ts`, 60 ItemCards) is used. In production without preload: disconnected API.
 *
 * The mock is loaded by dynamic `import()` under the `import.meta.env.DEV` guard: in a production
 * build the branch is removed and neither `mock.ts` nor the fixture is bundled.
 * `initApi()` must be awaited before the first render (`main.tsx`); `getApi()` stays synchronous.
 */
import type { RecoltApi } from '../../../preload/api'

function disconnectedApi(): RecoltApi {
  return {
    invoke: () =>
      Promise.resolve({
        ok: false,
        error: { code: 'not_implemented', message: 'preload missing' },
      }),
    on: () => () => undefined,
    startDrag: () => undefined,
    pathForFile: () => '',
    perfMark: () => undefined,
    onFlushRequest: () => () => undefined,
    flushDone: () => undefined,
    applyBatchSync: () => null,
    flags: { theme: 'light', e2e: false, lang: 'fr', systemLang: 'fr' },
  }
}

function wantsMock(): boolean {
  if (!import.meta.env.DEV) return false
  if (typeof window === 'undefined') return true
  return !window.recolt || new URLSearchParams(window.location.search).has('mock')
}

let api: RecoltApi | null = null

/** Picks the API (mock in dev if requested, otherwise preload) and loads the mock if needed. */
export async function initApi(): Promise<RecoltApi> {
  if (api) return api
  if (import.meta.env.DEV && wantsMock()) {
    const { createMockApi } = await import('./mock')
    api = createMockApi()
  } else {
    api = (typeof window !== 'undefined' ? window.recolt : undefined) ?? disconnectedApi()
  }
  return api
}

/**
 * Synchronous: after `initApi()`. Before it, returns the real or disconnected API,
 * never the mock.
 */
export function getApi(): RecoltApi {
  if (api) return api
  return (typeof window !== 'undefined' ? window.recolt : undefined) ?? disconnectedApi()
}

/** Tests: inject an API. */
export function setApiForTests(next: RecoltApi | null): void {
  api = next
}
