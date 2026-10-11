/**
 * Accès à `window.recolt` (preload). Hors Electron (navigateur) ou avec `?mock` en dev,
 * on utilise l'API maquette (`mock.ts`, 60 ItemCard). En production sans preload : API déconnectée.
 */
import type { RecoltApi } from '../../../preload/api'
import { createMockApi } from './mock'

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

export function getApi(): RecoltApi {
  if (api) return api
  // `import.meta.env.DEV` est remplacé à la compilation : la maquette disparaît du build de prod.
  if (import.meta.env.DEV && wantsMock()) api = createMockApi()
  else api = (typeof window !== 'undefined' ? window.recolt : undefined) ?? disconnectedApi()
  return api
}

/** Tests : injecter une API. */
export function setApiForTests(next: RecoltApi | null): void {
  api = next
}

export const isMockApi = (): boolean => wantsMock()
