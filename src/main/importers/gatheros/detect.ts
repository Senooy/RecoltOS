/**
 * GatherOS detection: libraries from `libraries.json`, `SingletonLock` lock
 * (`<host>-<pid>`, pid after the LAST dash, check `kill(pid, 0)` + `ps -p <pid> -o comm=`,
 * then `pgrep -x GatherOS`), consistent copy of the database and preview of the counts.
 * Read-only: nothing is ever written to the GatherOS folder; `prefs.json` is only read via
 * the allowlist (never the GatherOS extension token).
 */
import Database from 'better-sqlite3'
import { execFile } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { AppError } from '../../../shared/errors'
import type { ImportPreview } from '../../../shared/ipc/import'
import { isGatherOSRunning } from '../../platform/process-check'
import { STARTER_TAG } from './map'
import { readGatheros } from './read'
import { mt } from '../../i18n'

const execFileP = promisify(execFile)

export function gatherosRoot(home: string): string {
  return join(home, 'Library', 'Application Support', 'GatherOS')
}

const LibrariesJson = z.looseObject({
  active: z.string().optional(),
  libraries: z
    .array(z.looseObject({ id: z.string(), name: z.string().catch('Library') }))
    .catch([]),
})

export interface GatherosLibrary {
  id: string
  name: string
  dir: string
  dbPath: string
  imagesDir: string
  thumbsDir: string
}

export function listGatherosLibraries(root: string): {
  active: string | null
  libraries: GatherosLibrary[]
} {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(root, 'libraries.json'), 'utf8'))
  } catch {
    return { active: null, libraries: [] }
  }
  const parsed = LibrariesJson.safeParse(raw)
  if (!parsed.success) return { active: null, libraries: [] }
  const libraries = parsed.data.libraries
    .filter((l) => /^[A-Za-z0-9_-]{1,80}$/.test(l.id))
    .map((l) => {
      const dir = join(root, 'libraries', l.id)
      return {
        id: l.id,
        name: l.name,
        dir,
        dbPath: join(dir, 'moodmark.db'),
        imagesDir: join(dir, 'images'),
        thumbsDir: join(dir, 'thumbs'),
      }
    })
    .filter((l) => existsSync(l.dbPath))
  return { active: parsed.data.active ?? null, libraries }
}

export function pickLibrary(root: string, id?: string): GatherosLibrary {
  const { active, libraries } = listGatherosLibraries(root)
  const lib = libraries.find((l) => l.id === (id ?? active)) ?? (id ? undefined : libraries[0])
  if (!lib) throw new AppError('not_found', mt().errors.gatherosNotFound)
  return lib
}

/** `macbook-pro-de-test.home-26365` → host and pid (after the LAST dash). */
export function parseSingletonLock(target: string): { host: string; pid: number } | null {
  const i = target.lastIndexOf('-')
  if (i <= 0) return null
  const pid = Number(target.slice(i + 1))
  if (!Number.isInteger(pid) || pid <= 0) return null
  return { host: target.slice(0, i), pid }
}

export interface LockDeps {
  readlink?: (p: string) => string
  kill?: (pid: number) => void
  psComm?: (pid: number) => Promise<string>
  pgrep?: () => Promise<boolean>
}

export interface RunningState {
  running: boolean
  host: string | null
  pid: number | null
}

/** Is GatherOS running? The lock alone is not enough (pid reused): the process is checked. */
export async function detectRunning(root: string, deps: LockDeps = {}): Promise<RunningState> {
  const readlink = deps.readlink ?? ((p: string) => readlinkSync(p))
  const kill = deps.kill ?? ((pid: number) => process.kill(pid, 0))
  const psComm =
    deps.psComm ??
    (async (pid: number) => (await execFileP('/bin/ps', ['-p', String(pid), '-o', 'comm='])).stdout)
  let lock: { host: string; pid: number } | null = null
  try {
    lock = parseSingletonLock(readlink(join(root, 'SingletonLock')))
  } catch {
    lock = null
  }
  if (lock) {
    let alive = false
    try {
      kill(lock.pid)
      alive = true
    } catch (err) {
      alive = (err as NodeJS.ErrnoException).code === 'EPERM'
    }
    if (alive) {
      const comm = await psComm(lock.pid).catch(() => '')
      if (/gatheros/i.test(comm)) return { running: true, host: lock.host, pid: lock.pid }
    }
  }
  // Without `SingletonLock`, this GatherOS profile is not open (Chromium always creates it): the
  // global `pgrep` check only serves to break a tie for a lock whose pid was reused.
  if (!lock) return { running: false, host: null, pid: null }
  const viaPgrep = await (deps.pgrep ?? (() => isGatherOSRunning()))().catch(() => false)
  return viaPgrep
    ? { running: true, host: lock?.host ?? null, pid: null }
    : { running: false, host: null, pid: null }
}

/**
 * Consistent copy: `moodmark.db` and `-wal` copied together into `workDir`, the COPY
 * is opened for writing (SQLite replays the WAL), `wal_checkpoint(TRUNCATE)`, `quick_check`.
 * No connection is opened on the source: its bytes (db, wal, shm) remain identical.
 */
export function snapshotGatherosDb(
  dbPath: string,
  workDir: string,
): { path: string; userVersion: number } {
  mkdirSync(workDir, { recursive: true })
  const dst = join(workDir, 'moodmark.db')
  copyFileSync(dbPath, dst)
  if (existsSync(`${dbPath}-wal`)) copyFileSync(`${dbPath}-wal`, `${dst}-wal`)
  const db = new Database(dst, { fileMustExist: true })
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
    const qc = db.pragma('quick_check', { simple: true })
    if (qc !== 'ok') throw new AppError('library_unavailable', mt().errors.gatherosDamaged)
    const userVersion = Number(db.pragma('user_version', { simple: true }))
    db.pragma('journal_mode = DELETE')
    return { path: dst, userVersion }
  } finally {
    db.close()
  }
}

function dirBytes(dir: string): number {
  let total = 0
  try {
    for (const name of readdirSync(dir)) {
      try {
        const st = statSync(join(dir, name))
        if (st.isFile()) total += st.size
      } catch {
        // ignored
      }
    }
  } catch {
    // folder missing
  }
  return total
}

/** Counts for the detection card, computed on a copy (never on the source). */
export function previewGatheros(
  lib: GatherosLibrary,
  workDir: string,
): { preview: ImportPreview; schemaVersion: number } {
  const snap = snapshotGatherosDb(lib.dbPath, workDir)
  const data = readGatheros(snap.path)
  const isStarter = (id: string) => (data.tagsBySave.get(id) ?? []).includes(STARTER_TAG)
  const saves = data.saves.filter((s) => !isStarter(s.id))
  const count = (k: string) => saves.filter((s) => s.kind === k).length
  const tags = new Set<string>()
  for (const s of saves) for (const t of data.tagsBySave.get(s.id) ?? []) tags.add(t)
  for (const t of [STARTER_TAG, 'bookmark', 'instagram', 'cosmos']) tags.delete(t)
  return {
    schemaVersion: snap.userVersion,
    preview: {
      items: saves.length,
      images: count('image'),
      videos: count('video'),
      posts: count('tweet'),
      links: count('url'),
      collections: data.collections.length,
      tags: tags.size,
      trash: saves.filter((s) => s.deleted_at !== null).length,
      hidden: saves.filter((s) => s.hidden_at !== null && s.deleted_at === null).length,
      starter: data.saves.length - saves.length,
      bytes: dirBytes(lib.imagesDir),
    },
  }
}

/** Allowlist of GatherOS settings: the extension token is never read. */
export const PREFS_WHITELIST = [
  'theme',
  'defaultSort',
  'defaultColumns',
  'defaultMode',
  'captureShortcut',
  'captureMode',
  'captureDropFolder',
  'trashAutoEmptyDays',
  'syncXEnabled',
  'syncInstagramEnabled',
  'syncCosmosEnabled',
  'autoNameOnSave',
  'semanticSearch',
  'videoMuted',
] as const

export function readGatherosPrefs(
  root: string,
): Partial<Record<(typeof PREFS_WHITELIST)[number], unknown>> {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(root, 'prefs.json'), 'utf8'))
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object') return {}
  const out: Partial<Record<(typeof PREFS_WHITELIST)[number], unknown>> = {}
  for (const key of PREFS_WHITELIST) {
    const v = (raw as Record<string, unknown>)[key]
    if (v !== undefined) out[key] = v
  }
  return out
}
