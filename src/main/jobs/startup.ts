/**
 * Ménage à l'ouverture d'une bibliothèque (ARCHI §5.3) : jobs `running` → `queued` (reprise après
 * crash), jobs terminés de plus de 7 jours supprimés, fichiers temporaires orphelins (`.part`,
 * `.decoded.*`…) supprimés : à ce moment, aucun job ne tourne dans cette bibliothèque.
 */
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { LibraryContext } from '../library/library-context'

const DAY = 86_400_000

/** Supprime les `.part` / `.decoded.*` de `tmp/` (aucun job ne tourne encore) et les vieux jobs. */
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
