/**
 * Cleanup when a library is opened: `running` jobs → `queued` (resume after a
 * crash), finished jobs older than 7 days deleted, orphaned temporary files (`.part`,
 * `.decoded.*`...) deleted: at this point, no job is running in this library.
 */
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { LibraryContext } from '../library/library-context'

const DAY = 86_400_000

/** Deletes the `.part` / `.decoded.*` files in `tmp/` (no job is running yet) and the old jobs. */
export async function cleanupAtOpen(lib: LibraryContext, now = Date.now()): Promise<void> {
  lib.repos.jobs.resetRunning(now)
  lib.repos.jobs.cleanup(now - 7 * DAY)
  const tmp = lib.paths.dir('tmp')
  let names: string[] = []
  try {
    names = await readdir(tmp)
  } catch {
    return
  }
  for (const name of names) {
    if (!/\.part$|\.decoded\.|\.dl$|\.clip$|\.page\.png$/.test(name)) continue
    const abs = join(tmp, name)
    const st = await stat(abs).catch(() => null)
    if (st?.isFile()) await rm(abs, { force: true })
  }
}
