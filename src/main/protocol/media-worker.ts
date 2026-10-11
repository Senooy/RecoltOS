/**
 * Accès au media-worker pour les handlers `system.*` (`toPng` de `system.copyImage`).
 *
 * Adaptateur local (PLAN §2.7) : le worker partagé est créé par la file de jobs (WP-10,
 * `jobs/init.ts`), qui n'existe pas encore. Tant qu'aucun fournisseur n'est déclaré via
 * `provideMediaWorker()`, un worker dédié est lancé au premier besoin et arrêté au `dispose` du
 * domaine `protocol`. Demande consignée dans `docs/contrats/CHANGELOG.md` (WP-05).
 */
import type { MediaWorker } from '../workers-host'

export type MediaWorkerFactory = () => MediaWorker

let provider: (() => MediaWorker | null) | null = null
let factory: MediaWorkerFactory | null = null
let local: MediaWorker | null = null

/** WP-10 : déclare le worker partagé (le worker local éventuel est alors arrêté). */
export function provideMediaWorker(fn: (() => MediaWorker | null) | null): void {
  provider = fn
  if (fn && local) void stopLocalMediaWorker()
}

/** `init.ts` : fabrique du worker local (Electron `utilityProcess`). */
export function setLocalMediaWorkerFactory(fn: MediaWorkerFactory | null): void {
  factory = fn
}

/** Worker partagé s'il est déclaré, sinon worker local lancé à la demande, sinon `null`. */
export function getMediaWorker(): MediaWorker | null {
  const shared = provider?.() ?? null
  if (shared) return shared
  if (!local && factory) local = factory()
  return local
}

/** Worker local en cours (pour transmettre les outils re-détectés). */
export function localMediaWorker(): MediaWorker | null {
  return local
}

export async function stopLocalMediaWorker(): Promise<void> {
  const w = local
  local = null
  if (w) await w.stop()
}

/** Tests uniquement. */
export function resetMediaWorkerAccessForTests(): void {
  provider = null
  factory = null
  local = null
}
