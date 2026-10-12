/**
 * Purge automatique de la corbeille : `trashAutoEmptyDays` = 0 (jamais, défaut), 7, 30
 * ou 90. Au démarrage puis toutes les 6 h ; fichiers envoyés dans la Corbeille macOS (`mode:'trash'`,
 * récupérables) ; snapshot `-pre-purge` (`VACUUM INTO`) au-delà de 50 éléments ; lots de 500 ids
 * (un lot = une transaction = un job `purge.files`).
 */
import { chunks } from '../db/repos/util'
import { snapshotPath, vacuumInto } from '../db/migrate'
import type { JobLogger, JobServices } from './handlers/types'

export const AUTO_PURGE_EVERY_MS = 6 * 3_600_000
const DAY = 86_400_000

export interface AutoPurgeResult {
  purged: number
  snapshot: string | null
}

/** Une passe : renvoie le nombre d'éléments purgés (0 si la durée vaut 0). */
export function runAutoPurge(
  s: JobServices,
  now = Date.now(),
): AutoPurgeResult & { uuids: string[] } {
  const days = s.prefs().trashAutoEmptyDays
  if (!days || days <= 0) return { purged: 0, snapshot: null, uuids: [] }
  const ids = s.lib.repos.items.trashedBefore(now - days * DAY)
  if (ids.length === 0) return { purged: 0, snapshot: null, uuids: [] }
  let snapshot: string | null = null
  if (ids.length > 50) {
    snapshot = snapshotPath(s.lib.paths.dir('snapshots'), 'pre-purge', now)
    vacuumInto(s.lib.db, snapshot)
  }
  const uuids = (
    s.lib.db
      .prepare('SELECT uuid FROM items WHERE id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(ids)) as { uuid: string }[]
  ).map((r) => r.uuid)
  let purged = 0
  for (const part of chunks(ids, 500)) purged += s.lib.repos.items.purge(part, 'trash').purged
  s.kick()
  return { purged, snapshot, uuids }
}

export function startAutoPurge(o: {
  services: () => JobServices | null
  log: JobLogger
  emitChanged: (uuids: string[]) => void
  everyMs?: number
}): () => void {
  const pass = () => {
    const s = o.services()
    if (!s) return
    try {
      const r = runAutoPurge(s)
      if (r.purged > 0) {
        o.log.info(`[jobs] purge automatique : ${r.purged} élément(s)`)
        o.emitChanged(r.uuids)
      }
    } catch (err) {
      o.log.error('[jobs] purge automatique impossible', err)
    }
  }
  const first = setTimeout(pass, 5_000)
  const timer = setInterval(pass, o.everyMs ?? AUTO_PURGE_EVERY_MS)
  first.unref?.()
  timer.unref?.()
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
