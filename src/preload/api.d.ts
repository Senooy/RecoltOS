/**
 * API exposée au renderer sous `window.recolt`. Le renderer n'appelle que
 * `rpc<C>()` typé (`src/renderer/src/lib/rpc.ts`), jamais `invoke` directement.
 */
import type { RpcResult } from '../shared/errors'

export interface RecoltFlags {
  /** Thème effectif au lancement (couleur de la première image). */
  theme: 'light' | 'dark'
  /** `RECOLTOS_E2E=1` : animations coupées, vidéos sans autoplay. */
  e2e: boolean
  /** Langue effective au lancement (premier rendu). */
  lang: 'fr' | 'en'
  /** Langue du système : résout `ui.language: 'system'` quand le réglage change. */
  systemLang: 'fr' | 'en'
}

export interface RecoltApi {
  /** Canal unique `rpc` : renvoie une enveloppe, ne lève pas pour une erreur applicative. */
  invoke(channel: string, input?: unknown): Promise<RpcResult<unknown>>
  /** Abonnement à `evt:<event>` ; renvoie la fonction de désabonnement. */
  on(event: string, cb: (payload: unknown) => void): () => void
  /** Glisser natif : à appeler pendant `dragstart` (PNG 128 px en dataURL). */
  startDrag(uuids: string[], iconDataUrl?: string): void
  /** `webUtils.getPathForFile` (File.path n'existe plus depuis Electron 32). */
  pathForFile(file: File): string
  perfMark(name: string): void
  /** Demandes de vidage avant fermeture (`app:flush-request`). */
  onFlushRequest(cb: (token: string) => void): () => void
  flushDone(token: string): void
  /** `spaces:applyBatchSync` : réservé à `beforeunload`, ≤ 2 000 nœuds. */
  applyBatchSync(payload: unknown): unknown
  readonly flags: RecoltFlags
}

declare global {
  interface Window {
    recolt?: RecoltApi
  }
}
