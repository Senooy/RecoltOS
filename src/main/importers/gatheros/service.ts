/**
 * Service d'import GatherOS côté main (IPC `import.gatheros.*`) : détection (sur une copie de la
 * base), lancement en tâche de fond, annulation, reprise d'un run interrompu, rapport. Branché par
 * `jobs/init.ts` (media-worker partagé, file de jobs, événements).
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { AppError } from '../../../shared/errors'
import type { ImportOptions, ImportProgress, ImportReport } from '../../../shared/ipc/import'
import type { PrefsPatch } from '../../../shared/prefs'
import type { JobLogger, MediaCaller } from '../../jobs/handlers/types'
import { getActiveLibrary, requireLibrary } from '../../library/library-context'
import {
  detectRunning,
  gatherosRoot,
  listGatherosLibraries,
  pickLibrary,
  previewGatheros,
  readGatherosPrefs,
} from './detect'
import { createImportRun, lastImportReport, pendingImport, runGatherosImport } from './run'

export interface ImportServiceDeps {
  home: string | null
  media: MediaCaller
  log: JobLogger
  kick(): void
  emitProgress(p: ImportProgress): void
  changed(uuids: string[]): void
  collectionsChanged(uuids: string[]): void
  applyPrefs(patch: PrefsPatch): void
  /** Crée la bibliothèque « Importée de GatherOS » et bascule dessus. */
  createLibrary(name: string): Promise<void>
  tmpDir(): string
}

let deps: ImportServiceDeps | null = null
let running: { runId: number; abort: AbortController; done: Promise<unknown> } | null = null

export function configureImportService(d: ImportServiceDeps | null): void {
  deps = d
}

function requireDeps(): ImportServiceDeps {
  if (!deps) throw new AppError('library_unavailable', 'Import indisponible.')
  return deps
}

function root(): string {
  return gatherosRoot(requireDeps().home ?? homedir())
}

export async function detectGatheros() {
  const d = requireDeps()
  const r = root()
  const { libraries, active } = listGatherosLibraries(r)
  const lib = libraries.find((l) => l.id === active) ?? libraries[0]
  const state = await detectRunning(r)
  if (!lib) {
    return {
      found: false,
      path: null,
      running: state.running,
      runningHost: state.host,
      schemaVersion: null,
      libraryName: null,
      counts: null,
    }
  }
  const work = mkdtempSync(join(d.tmpDir(), 'gatheros-detect-'))
  try {
    const { preview, schemaVersion } = previewGatheros(lib, work)
    return {
      found: true,
      path: lib.dir,
      running: state.running,
      runningHost: state.host,
      schemaVersion,
      libraryName: lib.name,
      counts: preview,
    }
  } catch (err) {
    d.log.warn('[import] détection impossible', err)
    return {
      found: true,
      path: lib.dir,
      running: state.running,
      runningHost: state.host,
      schemaVersion: null,
      libraryName: lib.name,
      counts: null,
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** Réglages GatherOS en liste blanche → patch de prefs (jamais de fournisseur IA). */
export function prefsPatchFromGatheros(g: Record<string, unknown>): PrefsPatch {
  const patch: Record<string, unknown> = {}
  if (g.theme === 'light' || g.theme === 'dark' || g.theme === 'system') patch.theme = g.theme
  if (typeof g.defaultColumns === 'number' && g.defaultColumns >= 2 && g.defaultColumns <= 8) {
    patch.defaultColumns = Math.round(g.defaultColumns)
  }
  if (typeof g.videoMuted === 'boolean') patch.videoMuted = g.videoMuted
  if ([0, 7, 30, 90].includes(g.trashAutoEmptyDays as number))
    patch.trashAutoEmptyDays = g.trashAutoEmptyDays
  if (typeof g.autoNameOnSave === 'boolean') patch.ai = { autoNameOnSave: g.autoNameOnSave }
  return patch
}

export async function startGatherosImport(input: {
  libraryId?: string
  options: ImportOptions
  target: 'active' | 'new'
  resumeRunId?: number
}): Promise<{ runId: number }> {
  const d = requireDeps()
  if (running) throw new AppError('busy', 'Un import est déjà en cours.')
  const r = root()
  const state = await detectRunning(r)
  if (state.running) {
    throw new AppError('gatheros_running', 'Quitte GatherOS pour importer.', { host: state.host })
  }
  const source = pickLibrary(r, input.libraryId)
  if (input.target === 'new') await d.createLibrary('Importée de GatherOS')
  const lib = requireLibrary()
  const abort = new AbortController()
  // Un run interrompu (crash) est repris : chaque phase est idempotente (ARCHI §6.3).
  const runId =
    input.resumeRunId ??
    pendingImport(lib)?.runId ??
    createImportRun(lib, source, input.options, Date.now())
  const done = runGatherosImport(
    { source, options: input.options, runId },
    {
      lib,
      hashFile: (abs) => d.media('hashFile', { abs }, { timeoutMs: 600_000 }),
      cloneFile: (src, dst) => d.media('cloneFile', { src, dst }, { timeoutMs: 600_000 }),
      log: d.log,
      signal: abort.signal,
      onProgress: (p) => d.emitProgress(p),
      kick: () => d.kick(),
      changed: (uuids) => d.changed(uuids),
      collectionsChanged: (uuids) => d.collectionsChanged(uuids),
      applyPrefs: () => d.applyPrefs(prefsPatchFromGatheros(readGatherosPrefs(r))),
    },
  )
    .catch((err: unknown) => {
      const e = err as { code?: string; message?: string }
      d.log.warn(`[import] arrêt : ${e.code ?? 'erreur'}`, err)
      d.emitProgress({
        runId,
        phase: 'done',
        done: 0,
        total: 0,
        message: e.code === 'cancelled' ? 'cancelled' : (e.message ?? 'erreur'),
      })
    })
    .finally(() => {
      running = null
    })
  running = { runId, abort, done }
  return { runId }
}

export function cancelGatherosImport(): void {
  running?.abort.abort()
}

export function lastReport(): ImportReport | null {
  const lib = getActiveLibrary()
  return lib ? lastImportReport(lib) : null
}

export function pending(): { runId: number; phase: string | null } | null {
  const lib = getActiveLibrary()
  if (!lib || running) return null
  const p = pendingImport(lib)
  return p ? { runId: p.runId, phase: p.phase } : null
}

/** Tests : attend la fin du run en cours. */
export async function waitForImport(): Promise<void> {
  await running?.done
}
