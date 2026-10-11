/**
 * Messages de contrôle internes main ↔ worker, en plus de `WorkerRequest/Response`
 * (`src/shared/worker-protocol.ts`). Préfixe `__` : jamais une opération métier.
 */
export const CONTROL_OPS = {
  /** Transmet la configuration (chemins des outils) ; renvoyé à chaque redémarrage. */
  configure: '__configure',
  /** Annule la requête `args.id` (AbortSignal côté worker). */
  cancel: '__cancel',
  ping: '__ping',
} as const

/** Premier message d'un worker prêt à recevoir. */
export interface WorkerHello {
  ready: true
  pid: number
}

export function isHello(m: unknown): m is WorkerHello {
  return typeof m === 'object' && m !== null && (m as WorkerHello).ready === true
}
