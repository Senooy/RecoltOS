/**
 * Access to the media-worker for the `system.*` handlers (`toPng` of `system.copyImage`).
 *
 * Local adapter: the shared worker is created by the jobs queue
 * (`jobs/init.ts`). As long as no provider is declared via
 * `provideMediaWorker()`, a dedicated worker is started on first need and stopped at the
 * `dispose` of the `protocol` domain.
 */
import type { MediaWorker } from '../workers-host'

export type MediaWorkerFactory = () => MediaWorker

let provider: (() => MediaWorker | null) | null = null
let factory: MediaWorkerFactory | null = null
let local: MediaWorker | null = null

/** Declares the shared worker (any local worker is then stopped). */
export function provideMediaWorker(fn: (() => MediaWorker | null) | null): void {
  provider = fn
  if (fn && local) void stopLocalMediaWorker()
}

/** `init.ts`: factory of the local worker (Electron `utilityProcess`). */
export function setLocalMediaWorkerFactory(fn: MediaWorkerFactory | null): void {
  factory = fn
}

/** Shared worker if declared, otherwise local worker started on demand, otherwise `null`. */
export function getMediaWorker(): MediaWorker | null {
  const shared = provider?.() ?? null
  if (shared) return shared
  if (!local && factory) local = factory()
  return local
}

/** Current local worker (to pass on the re-detected tools). */
export function localMediaWorker(): MediaWorker | null {
  return local
}

export async function stopLocalMediaWorker(): Promise<void> {
  const w = local
  local = null
  if (w) await w.stop()
}

/** Tests only. */
export function resetMediaWorkerAccessForTests(): void {
  provider = null
  factory = null
  local = null
}
