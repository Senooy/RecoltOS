/**
 * Library manager: `libraries.json` registry, opening
 * of the active library, creation, switch (`closeLibrary` then opening, `library.switched`),
 * adding an existing folder, renaming, removal (files are never deleted).
 * Synced folders (iCloud Drive, Dropbox, CloudStorage) are refused: a SQLite database in
 * WAL mode synced by a file service gets corrupted.
 * No `electron` import: `emit` and the log are injected (testable under Node).
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { AppError } from '../../shared/errors'
import { LibraryId } from '../../shared/enums'
import { newLibraryId } from '../../shared/ids'
import type { LibraryInfo } from '../../shared/ipc/libraries'
import { closeLibrary } from '../db/close'
import { DB_FILE, openLibraryDb, type SlowQueryLogger } from '../db/open'
import { createRepos } from '../db/repos'
import { quarantine, writeJsonAtomic } from './atomic-write'
import {
  aggregatedCloseHooks,
  runAfterOpen,
  setActiveLibrary,
  type LibraryContext,
} from './library-context'
import { defaultLibraryRoot, LIBRARY_DIRS, libraryPaths, userDataPaths } from './paths'
import { mt } from '../i18n'

export const DEFAULT_LIBRARY_ID = 'default'
/** Name of the default library, in the active language at the time of its creation. */
export function defaultLibraryName(): string {
  return mt().library.defaultName
}

const RegistryEntry = z.object({
  id: LibraryId,
  name: z.string().min(1),
  /** `null` = `userData/libraries/<id>`; otherwise an external absolute path. */
  path: z.string().startsWith('/').nullable(),
  createdAt: z.number().int().nonnegative(),
})
export type RegistryEntry = z.output<typeof RegistryEntry>

export const LibrariesRegistry = z.object({
  version: z.literal(1),
  active: LibraryId,
  libraries: z.array(RegistryEntry).min(1),
})
export type LibrariesRegistry = z.output<typeof LibrariesRegistry>

/** Same rule as the IPC contract name (`shared/ipc/libraries.ts`): trimmed, 1 to 100 characters. */
const LibraryName = z.string().trim().min(1).max(100)

function parseName(name: unknown): string {
  const r = LibraryName.safeParse(name)
  if (!r.success) {
    throw new AppError('validation', mt().errors.libraryNameLength)
  }
  return r.data
}

/** Lenient read: only valid entries are kept (a damaged entry does not empty the registry). */
const LenientRegistry = z.object({
  version: z.literal(1),
  active: z.unknown().optional(),
  libraries: z.array(z.unknown()),
})

// ---------------------------------------------------------------------------------------------
// Synced folders
// ---------------------------------------------------------------------------------------------

/**
 * Real path of the nearest existing ancestor, with the disk's casing
 * (`realpathSync.native` restores it on macOS, unlike the JS version).
 */
function realpathOfNearest(p: string): string {
  let cur = path.resolve(p)
  const rest: string[] = []
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...rest.reverse())
    } catch {
      const parent = path.dirname(cur)
      if (parent === cur) return path.resolve(p)
      rest.push(path.basename(cur))
      cur = parent
    }
  }
}

/** APFS ignores case: all path comparisons are done in lowercase. */
const fold = (s: string): string => s.toLowerCase()

const isUnder = (p: string, dir: string): boolean => {
  const a = fold(p)
  const b = fold(dir)
  return a === b || a.startsWith(b + path.sep)
}

/** Synced folder segments (compared case-insensitively). */
const SYNCED_SEGMENTS: readonly RegExp[] = [
  /^dropbox( \(.+\))?$/i,
  /^com~apple~clouddocs$/i,
  /^onedrive( - .+)?$/i,
  /^google drive$/i,
]

/**
 * True if `target` is in a synced folder: iCloud Drive (`~/Library/Mobile Documents`,
 * Desktop / Documents synced by iCloud), `~/Library/CloudStorage` (File Provider), legacy
 * folders `~/Dropbox`, `~/OneDrive`, `~/Google Drive`, or an ancestor marked `.dropbox`.
 */
export function isSyncedFolder(target: string, home: string = os.homedir()): boolean {
  const candidates = new Set([path.resolve(target), realpathOfNearest(target)])
  const homes = new Set([path.resolve(home), realpathOfNearest(home)])
  for (const p of candidates) {
    const segments = p.split(path.sep)
    if (segments.some((s) => SYNCED_SEGMENTS.some((re) => re.test(s)))) return true
    for (const h of homes) {
      const lib = path.join(h, 'Library')
      if (isUnder(p, path.join(lib, 'Mobile Documents'))) return true
      if (isUnder(p, path.join(lib, 'CloudStorage'))) return true
      const cloudDocs = path.join(lib, 'Mobile Documents', 'com~apple~CloudDocs')
      for (const synced of ['Desktop', 'Documents']) {
        if (isUnder(p, path.join(h, synced)) && fs.existsSync(path.join(cloudDocs, synced))) {
          return true
        }
      }
    }
    for (let dir = p; ; dir = path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, '.dropbox'))) return true
      if (path.dirname(dir) === dir) break
    }
  }
  return false
}

function assertNotSynced(target: string, home: string): void {
  if (isSyncedFolder(target, home)) {
    throw new AppError('synced_folder_refused', mt().errors.syncedFolder)
  }
}

// ---------------------------------------------------------------------------------------------
// Conversion of system / SQLite errors
// ---------------------------------------------------------------------------------------------

/**
 * Converts a system error (`EACCES`…) or SQLite error (`SQLITE_NOTADB`…) into an `AppError` with a French message:
 * the IPC router passes through as-is any object carrying `code` and `message`
 * strings. `AppError`s and errors without a textual `code` (which become `internal` on the
 * router side) are returned unchanged. The original error is kept, described as a plain object
 * (cloneable via IPC), in `details`.
 */
export function toAppError(err: unknown): unknown {
  if (err instanceof AppError) return err
  if (typeof err !== 'object' || err === null) return err
  const e = err as { code?: unknown; message?: unknown; syscall?: unknown; path?: unknown }
  if (typeof e.code !== 'string') return err
  const details = {
    code: e.code,
    ...(typeof e.syscall === 'string' ? { syscall: e.syscall } : {}),
    ...(typeof e.path === 'string' ? { path: e.path } : {}),
    ...(typeof e.message === 'string' ? { message: e.message } : {}),
  }
  switch (e.code) {
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return new AppError('io', mt().errors.noWritePermission, details)
    case 'ENOSPC':
      return new AppError('io', mt().errors.diskFull, details)
    case 'ENOENT':
    case 'ENOTDIR':
      return new AppError('library_unavailable', mt().errors.libraryFolderMissing, details)
    case 'SQLITE_BUSY':
    case 'SQLITE_LOCKED':
      return new AppError('busy', mt().errors.libraryLocked, details)
    default:
      if (e.code.startsWith('SQLITE_')) {
        return new AppError('library_unavailable', mt().errors.dbUnreadable, details)
      }
      return new AppError('io', mt().errors.folderOpFailed, details)
  }
}

// ---------------------------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------------------------

export interface LibraryManagerDeps {
  userData: string
  /** `RECOLTOS_HOME` in tests, otherwise `os.homedir()`. */
  home?: string
  now?: () => number
  emit?(event: 'library.switched', payload: { libraryId: string }): void
  log?: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void }
  onSlowQuery?: SlowQueryLogger
  busyTimeout?: number
  checkpointBusyTimeoutMs?: number
}

export type LibraryManager = ReturnType<typeof createLibraryManager>

export function createLibraryManager(deps: LibraryManagerDeps) {
  const now = deps.now ?? Date.now
  const home = deps.home ?? os.homedir()
  const files = userDataPaths(deps.userData)
  let registry: LibrariesRegistry | null = null
  let ctx: LibraryContext | null = null
  /** Serializes opening / switching / creation. */
  let queue: Promise<unknown> = Promise.resolve()

  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const guarded = async (): Promise<T> => {
      try {
        return await fn()
      } catch (err) {
        throw toAppError(err)
      }
    }
    const run = queue.then(guarded, guarded)
    queue = run.catch(() => undefined)
    return run
  }

  const defaultRegistry = (): LibrariesRegistry => ({
    version: 1,
    active: DEFAULT_LIBRARY_ID,
    libraries: [
      { id: DEFAULT_LIBRARY_ID, name: defaultLibraryName(), path: null, createdAt: now() },
    ],
  })

  const save = (r: LibrariesRegistry) => {
    writeJsonAtomic(files.libraries, r)
    registry = r
  }

  const load = (): LibrariesRegistry => {
    if (registry) return registry
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(files.libraries, 'utf8'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        deps.log?.warn('[library] libraries.json unreadable, set aside', err)
        quarantine(files.libraries, now())
      }
      save(defaultRegistry())
      return registry!
    }
    const lenient = LenientRegistry.safeParse(raw)
    const entries: RegistryEntry[] = []
    let dropped = 0
    if (lenient.success) {
      const seen = new Set<string>()
      for (const candidate of lenient.data.libraries) {
        const e = RegistryEntry.safeParse(candidate)
        if (e.success && !seen.has(e.data.id)) {
          seen.add(e.data.id)
          entries.push(e.data)
        } else {
          dropped++
          deps.log?.warn(
            '[library] invalid libraries.json entry, dropped',
            e.success ? 'identifiant en double' : e.error.issues,
          )
        }
      }
    }
    if (!lenient.success || entries.length === 0) {
      deps.log?.warn(
        '[library] invalid libraries.json, set aside',
        lenient.success ? 'no valid entry' : lenient.error.issues,
      )
      quarantine(files.libraries, now())
      save(defaultRegistry())
      return registry!
    }
    const active = LibraryId.safeParse(lenient.data.active)
    const r: LibrariesRegistry = {
      version: 1,
      active:
        active.success && entries.some((l) => l.id === active.data) ? active.data : entries[0]!.id,
      libraries: entries,
    }
    if (dropped > 0) {
      // Keeps the original aside, then rewrites the cleaned registry.
      quarantine(files.libraries, now())
      save(r)
      return r
    }
    registry = r
    return r
  }

  const entry = (id: string): RegistryEntry => {
    const e = load().libraries.find((l) => l.id === id)
    if (!e) throw new AppError('not_found', mt().errors.libraryNotFound)
    return e
  }

  const rootOf = (e: RegistryEntry) => e.path ?? defaultLibraryRoot(deps.userData, e.id)

  /**
   * Refuses a chosen folder located in `userData/libraries` or at the root of a library
   * already registered: `tmp/` and `items/` are managed there (staging, restores), a cleanup by
   * another library would destroy the nested library. Case-insensitive comparison.
   */
  const assertNotManaged = (target: string): void => {
    const candidates = [...new Set([path.resolve(target), realpathOfNearest(target)])]
    const managed = [files.librariesDir, ...load().libraries.map(rootOf)]
    for (const dir of managed) {
      for (const d of new Set([path.resolve(dir), realpathOfNearest(dir)])) {
        if (candidates.some((p) => isUnder(p, d))) {
          throw new AppError('conflict', mt().errors.folderUsedByLibrary)
        }
      }
    }
  }

  /** Opening options shared by `openEntry` and the reopening in `closeActive`. */
  const dbOptions = () => ({
    ...(deps.onSlowQuery ? { onSlowQuery: deps.onSlowQuery } : {}),
    ...(deps.busyTimeout !== undefined ? { busyTimeout: deps.busyTimeout } : {}),
    now,
  })

  /**
   * Rollback of a creation: removes the created folder, or, if it already existed (empty), only
   * what the creation wrote there. Pre-existing hidden files are kept.
   */
  const discardCreatedRoot = (root: string, existed: boolean): void => {
    try {
      if (!existed) {
        fs.rmSync(root, { recursive: true, force: true })
        return
      }
      for (const f of fs.readdirSync(root)) {
        if (!f.startsWith('.')) fs.rmSync(path.join(root, f), { recursive: true, force: true })
      }
    } catch (err) {
      deps.log?.warn('[library] cleanup of the cancelled creation impossible', err)
    }
  }

  const countItems = (e: RegistryEntry): number => {
    if (ctx && ctx.id === e.id) return ctx.repos.items.countLive()
    const file = path.join(rootOf(e), DB_FILE)
    if (!fs.existsSync(file)) return 0
    try {
      const db = new Database(file, { readonly: true, fileMustExist: true })
      try {
        return (
          db
            .prepare(
              'SELECT count(*) AS n FROM items WHERE deleted_at IS NULL AND hidden_at IS NULL',
            )
            .get() as { n: number }
        ).n
      } finally {
        db.close()
      }
    } catch {
      return 0
    }
  }

  const info = (e: RegistryEntry): LibraryInfo => ({
    id: e.id,
    name: e.name,
    path: e.path,
    itemCount: countItems(e),
  })

  /**
   * Opens a library (folders, migrations, repos) and makes it active.
   * Except `create` and `default` (created at first launch), a library whose folder or
   * `recolt.db` has disappeared is refused: otherwise SQLite would silently recreate an empty database.
   */
  const openEntry = async (
    e: RegistryEntry,
    opts: { create?: boolean } = {},
  ): Promise<LibraryContext> => {
    const root = rootOf(e)
    const mayCreate = opts.create === true || e.id === DEFAULT_LIBRARY_ID
    if (!mayCreate && (!fs.existsSync(root) || !fs.existsSync(path.join(root, DB_FILE)))) {
      throw new AppError('library_unavailable', mt().errors.libraryFolderNotFound(root))
    }
    const paths = libraryPaths(root)
    for (const d of LIBRARY_DIRS) fs.mkdirSync(paths.dir(d), { recursive: true })
    fs.mkdirSync(path.join(paths.dir('spaces'), 'assets'), { recursive: true })
    const { db, migration } = openLibraryDb(root, dbOptions())
    if (migration.applied.length > 0) {
      deps.log?.info(`[library] ${e.id} migrated v${migration.from} → v${migration.to}`)
    }
    const next: LibraryContext = {
      id: e.id,
      name: e.name,
      root: paths.root,
      paths,
      db,
      repos: createRepos(db, { now }),
    }
    ctx = next
    setActiveLibrary(next)
    try {
      await runAfterOpen(next)
    } catch (err) {
      // Incomplete opening: the database is closed and no library is active.
      ctx = null
      setActiveLibrary(null)
      try {
        next.db.close()
      } catch {
        // already closed
      }
      throw err
    }
    return next
  }

  const closeActive = async (forReplace = false): Promise<void> => {
    const current = ctx
    if (!current) return
    const hooks = aggregatedCloseHooks()
    /**
     * After a `wal_not_empty`, `closeLibrary` reopened the database (`closable.db`): the connection of
     * `current` is closed. The context receives the new connection, and the domains are
     * notified by `afterOpen` (they must not keep the old one), before the restart.
     */
    const adoptReopened = async (): Promise<void> => {
      if (closable.db === current.db) return
      current.db = closable.db
      current.repos = createRepos(closable.db, { now })
      try {
        await runAfterOpen(current)
      } catch (err) {
        deps.log?.error('[library] afterOpen failed after cancelled reopening', err)
      }
    }
    const closable = {
      db: current.db,
      dbFile: current.paths.db,
      hooks: {
        ...hooks,
        async startWorkers() {
          await adoptReopened()
          await hooks.startWorkers()
        },
      },
      reopen: () => openLibraryDb(current.root, dbOptions()).db,
      ...(deps.log ? { log: deps.log } : {}),
    }
    try {
      await closeLibrary(closable, {
        forReplace,
        ...(deps.checkpointBusyTimeoutMs !== undefined
          ? { checkpointBusyTimeoutMs: deps.checkpointBusyTimeoutMs }
          : {}),
      })
    } catch (err) {
      if (closable.db !== current.db) {
        // Cancelled (wal_not_empty) and database reopened: the library stays active.
        await adoptReopened()
      } else if (!current.db.open) {
        // Cancelled and reopening impossible: the library is no longer usable.
        ctx = null
        setActiveLibrary(null)
      }
      throw err
    }
    ctx = null
    setActiveLibrary(null)
  }

  /** Restarts workers then the job queue after a close followed by a successful opening. */
  const restartBackground = async (): Promise<void> => {
    const hooks = aggregatedCloseHooks()
    try {
      await hooks.startWorkers()
      await hooks.resumeJobs()
    } catch (err) {
      deps.log?.error('[library] restart of workers / job queue failed', err)
    }
  }

  const switchTo = async (id: string, opts: { create?: boolean } = {}): Promise<void> => {
    const target = entry(id)
    if (ctx?.id === id) return
    const previous = ctx ? entry(ctx.id) : null
    await closeActive(false)
    try {
      await openEntry(target, opts)
    } catch (err) {
      deps.log?.error(`[library] opening of ${id} failed`, err)
      if (previous) {
        await openEntry(previous)
        await restartBackground()
      }
      throw err
    }
    await restartBackground()
    save({ ...load(), active: id })
    deps.emit?.('library.switched', { libraryId: id })
  }

  const freshId = (): string => {
    const taken = new Set(load().libraries.map((l) => l.id))
    let t = now()
    let id = newLibraryId(t)
    while (taken.has(id)) id = newLibraryId(++t)
    return id
  }

  return {
    rootOf: (id: string) => rootOf(entry(id)),
    registry: () => structuredClone(load()),
    active: () => ctx,

    /** Startup: opens the active library; falls back to `default` if it is unavailable. */
    open(): Promise<LibraryContext> {
      return serial(async () => {
        if (ctx) return ctx
        const r = load()
        try {
          return await openEntry(entry(r.active))
        } catch (err) {
          if (r.active === DEFAULT_LIBRARY_ID) throw err
          deps.log?.error(
            `[library] ${r.active} indisponible, repli sur ${DEFAULT_LIBRARY_ID}`,
            err,
          )
          if (!r.libraries.some((l) => l.id === DEFAULT_LIBRARY_ID)) {
            r.libraries.unshift(defaultRegistry().libraries[0]!)
          }
          save({ ...r, active: DEFAULT_LIBRARY_ID })
          return openEntry(entry(DEFAULT_LIBRARY_ID))
        }
      })
    },

    /** Clean close (app exit). */
    close(): Promise<void> {
      return serial(() => closeActive(false))
    },

    /** Closes to replace the database file (restore); `wal_not_empty` if blocked. */
    closeForReplace(): Promise<void> {
      return serial(() => closeActive(true))
    },

    /** Reopens the active library after a replacement (restore). */
    reopen(): Promise<LibraryContext> {
      return serial(async () => {
        const r = load()
        await closeActive(false)
        const next = await openEntry(entry(r.active))
        await restartBackground()
        deps.emit?.('library.switched', { libraryId: next.id })
        return next
      })
    },

    list(): { active: string; libraries: LibraryInfo[] } {
      const r = load()
      return { active: ctx?.id ?? r.active, libraries: r.libraries.map(info) }
    },

    /**
     * Creates a library then switches to it. Without `dir`: `userData/libraries/<id>`;
     * otherwise the folder itself (non-existent or empty), refused if it is synced.
     */
    create(input: { name: string; path?: string }): Promise<LibraryInfo> {
      return serial(async () => {
        const name = parseName(input.name)
        const id = freshId()
        let custom: string | null = null
        if (input.path) {
          custom = path.resolve(input.path)
          assertNotSynced(custom, home)
          assertNotManaged(custom)
          const st = fs.statSync(custom, { throwIfNoEntry: false })
          if (st && !st.isDirectory()) {
            throw new AppError('validation', mt().errors.notAFolder)
          }
          if (fs.existsSync(path.join(custom, DB_FILE))) {
            throw new AppError('conflict', mt().errors.folderHasLibrary)
          }
          if (fs.existsSync(custom) && fs.readdirSync(custom).some((f) => !f.startsWith('.'))) {
            throw new AppError('conflict', mt().errors.chooseEmptyFolder)
          }
        }
        // Default location (`userData/libraries/<id>`): no check, like `open()`
        // (the app already lives there; in dev, `RECOLTOS_USER_DATA` may be under a synced folder).
        const e: RegistryEntry = { id, name, path: custom, createdAt: now() }
        const root = rootOf(e)
        const existed = fs.existsSync(root)
        fs.mkdirSync(root, { recursive: true })
        save({ ...load(), libraries: [...load().libraries, e] })
        try {
          await switchTo(id, { create: true })
        } catch (err) {
          const r = load()
          save({ ...r, libraries: r.libraries.filter((l) => l.id !== id) })
          discardCreatedRoot(root, existed)
          throw err
        }
        return info(e)
      })
    },

    switch(id: string): Promise<void> {
      return serial(() => switchTo(id))
    },

    /** Adds a folder containing `recolt.db` (or finds it) then switches to it. */
    addExisting(dir: string): Promise<LibraryInfo> {
      return serial(async () => {
        const root = path.resolve(dir)
        assertNotSynced(root, home)
        if (!fs.existsSync(path.join(root, DB_FILE))) {
          throw new AppError('not_found', mt().errors.noLibraryInFolder)
        }
        const r = load()
        let e = r.libraries.find((l) => path.resolve(rootOf(l)) === root)
        const added = !e
        if (!e) {
          e = {
            id: freshId(),
            name: path.basename(root).trim().slice(0, 100) || defaultLibraryName(),
            path: root,
            createdAt: now(),
          }
          save({ ...r, libraries: [...r.libraries, e] })
        }
        try {
          await switchTo(e.id)
        } catch (err) {
          // Rollback: an entry added by this call and unopenable does not stay in the registry.
          if (added) {
            const cur = load()
            const id = e.id
            save({ ...cur, libraries: cur.libraries.filter((l) => l.id !== id) })
          }
          throw err
        }
        return info(e)
      })
    },

    rename(id: string, name: string): LibraryInfo {
      const clean = parseName(name)
      const r = load()
      const e = entry(id)
      const next = { ...e, name: clean }
      try {
        save({ ...r, libraries: r.libraries.map((l) => (l.id === id ? next : l)) })
      } catch (err) {
        throw toAppError(err)
      }
      if (ctx?.id === id) ctx.name = next.name
      return info(next)
    },

    /** Removes from the registry (files kept). The open library cannot be removed. */
    remove(id: string): void {
      const r = load()
      entry(id)
      if ((ctx?.id ?? r.active) === id) {
        throw new AppError('conflict', mt().errors.cannotRemoveActive)
      }
      try {
        save({ ...r, libraries: r.libraries.filter((l) => l.id !== id) })
      } catch (err) {
        throw toAppError(err)
      }
    },
  }
}
