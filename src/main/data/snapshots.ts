/**
 * Database snapshots: `VACUUM INTO snapshots/recolt-<YYYYMMDD-HHmmss>[-reason].db`
 * (consistent under WAL, does not block readers). Automatic: `-daily` on the first launch of the
 * day, `-pre-vN` (migrations), `-pre-import`, `-pre-purge`, `-pre-restore`. Retention: the last 7
 * `daily`, the 20 most recent manual ones, all `pre-*` from the last 30 days. No electron import.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { SnapshotInfo } from '../../shared/ipc/data'
import { AppError } from '../../shared/errors'
import { snapshotPath, snapshotStamp, vacuumInto } from '../db/migrate'
import type { LibraryContext } from '../library/library-context'
import { mt } from '../i18n'

export const SNAPSHOT_RE = /^recolt-(\d{8})-(\d{6})(?:-([a-z0-9-]+))?\.db$/
export const KEEP_DAILY = 7
export const KEEP_MANUAL = 20
export const KEEP_PRE_MS = 30 * 86_400_000

type SnapLib = Pick<LibraryContext, 'db' | 'paths'>

const dirOf = (lib: Pick<LibraryContext, 'paths'>) => lib.paths.dir('snapshots')

/** `recolt-20261011-183000-pre-v1-2.db` → reason `pre-v1` (collision suffix removed). */
export function parseSnapshotName(
  name: string,
): { createdAt: number; reason: string | null } | null {
  const m = SNAPSHOT_RE.exec(name)
  if (!m) return null
  const d = m[1]!
  const t = m[2]!
  const createdAt = new Date(
    Number(d.slice(0, 4)),
    Number(d.slice(4, 6)) - 1,
    Number(d.slice(6, 8)),
    Number(t.slice(0, 2)),
    Number(t.slice(2, 4)),
    Number(t.slice(4, 6)),
  ).getTime()
  let reason = m[3] ?? null
  if (reason && /-\d+$/.test(reason) && !/^pre-v\d+$/.test(reason))
    reason = reason.replace(/-\d+$/, '')
  return { createdAt, reason }
}

/** Validated snapshot file (strict name, in `snapshots/`). */
export function snapshotFile(lib: Pick<LibraryContext, 'paths'>, name: string): string {
  if (!SNAPSHOT_RE.test(name) || name.includes('/')) {
    throw new AppError('validation', mt().errors.snapshotNameInvalid)
  }
  return path.join(dirOf(lib), name)
}

export function listSnapshots(lib: Pick<LibraryContext, 'paths'>): SnapshotInfo[] {
  let names: string[] = []
  try {
    names = fs.readdirSync(dirOf(lib))
  } catch {
    return []
  }
  const out: SnapshotInfo[] = []
  for (const name of names) {
    const parsed = parseSnapshotName(name)
    if (!parsed) continue
    let bytes = 0
    try {
      bytes = fs.statSync(path.join(dirOf(lib), name)).size
      for (const ext of ['-wal']) {
        const companion = path.join(dirOf(lib), `${name}${ext}`)
        if (fs.existsSync(companion)) bytes += fs.statSync(companion).size
      }
    } catch {
      continue
    }
    out.push({ name, createdAt: parsed.createdAt, bytes, reason: parsed.reason })
  }
  return out.sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name))
}

export function createSnapshot(lib: SnapLib, reason: string, at: number): SnapshotInfo {
  const clean = reason
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const file = snapshotPath(dirOf(lib), clean || 'manual', at)
  vacuumInto(lib.db, file)
  const name = path.basename(file)
  return {
    name,
    createdAt: parseSnapshotName(name)?.createdAt ?? at,
    bytes: fs.statSync(file).size,
    reason: parseSnapshotName(name)?.reason ?? null,
  }
}

/** Deletes a snapshot and its `-wal` / `-shm` companions, if any (`pre-restore`). */
export function deleteSnapshot(lib: Pick<LibraryContext, 'paths'>, name: string): void {
  const file = snapshotFile(lib, name)
  if (!fs.existsSync(file)) throw new AppError('not_found', mt().errors.snapshotNotFound)
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true })
}

/** Snapshots to delete according to retention. */
export function retentionVictims(list: readonly SnapshotInfo[], now: number): string[] {
  const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt)
  const daily = sorted.filter((s) => s.reason === 'daily')
  const manual = sorted.filter((s) => s.reason === null || s.reason === 'manual')
  const pre = sorted.filter((s) => s.reason?.startsWith('pre-'))
  return [
    ...daily.slice(KEEP_DAILY),
    ...manual.slice(KEEP_MANUAL),
    ...pre.filter((s) => now - s.createdAt > KEEP_PRE_MS),
  ].map((s) => s.name)
}

export function applyRetention(lib: Pick<LibraryContext, 'paths'>, now: number): string[] {
  const victims = retentionVictims(listSnapshots(lib), now)
  for (const name of victims) {
    try {
      deleteSnapshot(lib, name)
    } catch {
      // already deleted
    }
  }
  return victims
}

/** `-daily` on the first launch of the day (non-empty library), then retention. */
export function dailySnapshot(lib: SnapLib, now: number): SnapshotInfo | null {
  const today = snapshotStamp(now).slice(0, 8)
  const done = listSnapshots(lib).some(
    (s) => s.reason === 'daily' && s.name.startsWith(`recolt-${today}-`),
  )
  let created: SnapshotInfo | null = null
  const hasItems = (lib.db.prepare('SELECT count(*) AS n FROM items').get() as { n: number }).n > 0
  if (!done && hasItems) created = createSnapshot(lib, 'daily', now)
  applyRetention(lib, now)
  return created
}
