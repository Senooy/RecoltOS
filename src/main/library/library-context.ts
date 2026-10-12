/**
 * Active library: `{ id, root, paths, db, repos }`, and lifecycle hook points for the other
 * domains (workers, protocol, job queue). Only one library is open at a time. No `electron` import.
 */
import type Database from 'better-sqlite3'
import { AppError } from '../../shared/errors'
import type { CloseHooks } from '../db/close'
import type { Repos } from '../db/repos'
import type { LibraryPaths } from './paths'
import { mt } from '../i18n'

export interface LibraryContext {
  id: string
  name: string
  root: string
  paths: LibraryPaths
  db: Database.Database
  repos: Repos
}

/**
 * Lifecycle hooks, registered by the domains in their `init.ts`:
 * - `afterOpen`: the library has just been opened (startup, switch, restore);
 * - `pauseJobs` / `stopWorkers`: called by `closeLibrary` BEFORE the checkpoint;
 * - `startWorkers` / `resumeJobs`: restart after a cancelled `closeLibrary({forReplace})`, AND after
 *   each successful switch, fallback or `reopen()` (the manager calls them AFTER `afterOpen`, in
 *   reverse registration order). At startup (`open()`), only `afterOpen` is called: it
 *   starts the workers and the queue. All three must therefore be idempotent.
 *
 * WARNING: NEVER keep `ctx.db` or `ctx.repos` (nor a prepared statement) beyond the
 * call; re-read `requireLibrary()` at each use. After a cancelled `closeForReplace`
 * (`wal_not_empty`), the manager replaces `ctx.db` and `ctx.repos` with a new connection
 * (the `ctx` object stays the same) then calls `afterOpen(ctx)` again BEFORE `startWorkers`/`resumeJobs`:
 * an `afterOpen` must therefore be callable again for the same library and replace what it had
 * kept. A connection kept before this call is closed.
 */
export interface LibraryLifecycle extends CloseHooks {
  afterOpen?(ctx: LibraryContext): void | Promise<void>
}

let active: LibraryContext | null = null
const lifecycles = new Map<string, LibraryLifecycle>()

export function getActiveLibrary(): LibraryContext | null {
  return active
}

/** Active library or `AppError('library_unavailable')`. */
export function requireLibrary(): LibraryContext {
  if (!active) throw new AppError('library_unavailable', mt().errors.noLibrary)
  return active
}

export function setActiveLibrary(ctx: LibraryContext | null): void {
  active = ctx
}

/** Registers (or replaces) a domain's hooks; returns the unregister function. */
export function registerLibraryLifecycle(domain: string, lc: LibraryLifecycle): () => void {
  lifecycles.set(domain, lc)
  return () => {
    if (lifecycles.get(domain) === lc) lifecycles.delete(domain)
  }
}

/** Aggregated hooks, in registration order (restart: reverse order). */
export function aggregatedCloseHooks(): Required<CloseHooks> {
  const all = () => [...lifecycles.values()]
  return {
    async pauseJobs(ms) {
      for (const lc of all()) await lc.pauseJobs?.(ms)
    },
    async stopWorkers() {
      for (const lc of all()) await lc.stopWorkers?.()
    },
    async startWorkers() {
      for (const lc of all().reverse()) await lc.startWorkers?.()
    },
    async resumeJobs() {
      for (const lc of all().reverse()) await lc.resumeJobs?.()
    },
  }
}

export async function runAfterOpen(ctx: LibraryContext): Promise<void> {
  for (const lc of lifecycles.values()) await lc.afterOpen?.(ctx)
}

/** Tests only. */
export function resetLibraryContextForTests(): void {
  active = null
  lifecycles.clear()
}
