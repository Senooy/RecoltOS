/**
 * Accès à `window.recolt` (preload). Hors Electron (navigateur) ou avec `?mock` en dev,
 * on utilise l'API maquette (`mock.ts`, 60 ItemCard). En production sans preload : API déconnectée.
 *
 * La maquette est chargée par `import()` dynamique sous la garde `import.meta.env.DEV` : en
 * build de production la branche est supprimée et ni `mock.ts` ni la fixture ne sont embarqués.
 * `initApi()` doit être awaité avant le premier rendu (`main.tsx`) ; `getApi()` reste synchrone.
 */
import type { RecoltApi } from '../../../preload/api'

function disconnectedApi(): RecoltApi {
  return {
    invoke: () =>
      Promise.resolve({ ok: false, error: { code: 'not_implemented', message: 'preload absent' } }),
    on: () => () => undefined,
    startDrag: () => undefined,
    pathForFile: () => '',
    perfMark: () => undefined,
    onFlushRequest: () => () => undefined,
    flushDone: () => undefined,
    applyBatchSync: () => null,
    flags: { theme: 'light', e2e: false },
  }
}

function wantsMock(): boolean {
  if (!import.meta.env.DEV) return false
  if (typeof window === 'undefined') return true
  return !window.recolt || new URLSearchParams(window.location.search).has('mock')
}

let api: RecoltApi | null = null

/** Choisit l'API (maquette en dev si demandée, sinon preload) et charge la maquette si besoin. */
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

/** Synchrone : après `initApi()`. Avant, renvoie l'API réelle ou déconnectée (jamais la maquette). */
export function getApi(): RecoltApi {
  if (api) return api
  return (typeof window !== 'undefined' ? window.recolt : undefined) ?? disconnectedApi()
}

/** Tests : injecter une API. */
export function setApiForTests(next: RecoltApi | null): void {
  api = next
}
