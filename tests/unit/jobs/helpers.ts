/** Services de jobs sous Node : vraie base, media-worker en processus (`runMediaOp`), vrai réseau local. */
import { PrefsSchema, type Prefs } from '../../../src/shared/prefs'
import type { MediaArgs, MediaOp, MediaResult } from '../../../src/shared/worker-protocol'
import { jobFailureHooks, jobHandlers } from '../../../src/main/jobs/handlers'
import type { ChangeReason, JobServices } from '../../../src/main/jobs/handlers/types'
import { JobQueue } from '../../../src/main/jobs/queue'
import { libraryPaths } from '../../../src/main/library/paths'
import type { LibraryContext } from '../../../src/main/library/library-context'
import { runMediaOp } from '../../../src/main/workers/media/ops'
import { openTestLib, type TestLib } from '../db/helpers'
import { TOOLS } from '../media/helpers'

export interface JobsHarness {
  t: TestLib
  lib: LibraryContext
  services: JobServices
  queue: JobQueue
  changes: { uuids: string[]; reason: ChangeReason }[]
  prefs: Prefs
  cleanup(): Promise<void>
}

export function makeHarness(
  opts: {
    prefs?: Partial<Prefs>
    handlers?: Partial<typeof jobHandlers>
    clock?: () => number
  } = {},
): JobsHarness {
  const t = openTestLib()
  const lib: LibraryContext = {
    id: 'ltest',
    name: 'Test',
    root: t.root,
    paths: libraryPaths(t.root),
    db: t.db,
    repos: t.repos,
  }
  const prefs = PrefsSchema.parse({ ...opts.prefs })
  const changes: JobsHarness['changes'] = []
  let queue: JobQueue | null = null
  const services: JobServices = {
    lib,
    media: <O extends MediaOp>(op: O, args: MediaArgs<O>) =>
      runMediaOp(op, args, { tools: TOOLS }) as Promise<MediaResult<O>>,
    fetch: (url, init) => fetch(url, init),
    prefs: () => prefs,
    changed: (uuids, reason) => changes.push({ uuids: [...uuids], reason }),
    hasTool: (name) => Boolean(TOOLS[name]),
    kick: () => queue?.kick(),
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
  }
  queue = new JobQueue({
    services: () => services,
    handlers: { ...jobHandlers, ...opts.handlers },
    failureHooks: jobFailureHooks,
    tickMs: 20,
    ...(opts.clock ? { now: opts.clock } : {}),
  })
  const q = queue
  return {
    t,
    lib,
    services,
    queue: q,
    changes,
    prefs,
    async cleanup() {
      await q.stop()
      t.cleanup()
    },
  }
}
