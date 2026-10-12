/**
 * Gestionnaire de bibliothèques : registre `libraries.json`, ouverture
 * de la bibliothèque active, création, bascule (`closeLibrary` puis ouverture, `library.switched`),
 * ajout d'un dossier existant, renommage, retrait (les fichiers ne sont jamais supprimés).
 * Les dossiers synchronisés (iCloud Drive, Dropbox, CloudStorage) sont refusés : une base SQLite en
 * WAL synchronisée par un service de fichiers se corrompt.
 * Pas d'import `electron` : `emit` et le journal sont injectés (testable sous Node).
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
/** Nom de la bibliothèque par défaut, dans la langue active au moment de sa création. */
export function defaultLibraryName(): string {
  return mt().library.defaultName
}

const RegistryEntry = z.object({
  id: LibraryId,
  name: z.string().min(1),
  /** `null` = `userData/libraries/<id>` ; sinon chemin absolu externe. */
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

/** Même règle que le nom du contrat IPC (`shared/ipc/libraries.ts`) : rogné, 1 à 100 caractères. */
const LibraryName = z.string().trim().min(1).max(100)

function parseName(name: unknown): string {
  const r = LibraryName.safeParse(name)
  if (!r.success) {
    throw new AppError('validation', mt().errors.libraryNameLength)
  }
  return r.data
}

/** Lecture tolérante : seules les entrées valides sont gardées (une entrée abîmée ne vide pas le registre). */
const LenientRegistry = z.object({
  version: z.literal(1),
  active: z.unknown().optional(),
  libraries: z.array(z.unknown()),
})

// ---------------------------------------------------------------------------------------------
// Dossiers synchronisés
// ---------------------------------------------------------------------------------------------

/**
 * Chemin réel de l'ancêtre existant le plus proche, avec la casse du disque
 * (`realpathSync.native` la rétablit sur macOS, contrairement à la version JS).
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

/** APFS ignore la casse : toutes les comparaisons de chemins se font en minuscules. */
const fold = (s: string): string => s.toLowerCase()

const isUnder = (p: string, dir: string): boolean => {
  const a = fold(p)
  const b = fold(dir)
  return a === b || a.startsWith(b + path.sep)
}

/** Segments de dossiers synchronisés (comparés sans tenir compte de la casse). */
const SYNCED_SEGMENTS: readonly RegExp[] = [
  /^dropbox( \(.+\))?$/i,
  /^com~apple~clouddocs$/i,
  /^onedrive( - .+)?$/i,
  /^google drive$/i,
]

/**
 * Vrai si `target` est dans un dossier synchronisé : iCloud Drive (`~/Library/Mobile Documents`,
 * Bureau / Documents synchronisés par iCloud), `~/Library/CloudStorage` (File Provider), anciens
 * dossiers `~/Dropbox`, `~/OneDrive`, `~/Google Drive`, ou un ancêtre marqué `.dropbox`.
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
// Conversion des erreurs système / SQLite
// ---------------------------------------------------------------------------------------------

/**
 * Convertit une erreur système (`EACCES`…) ou SQLite (`SQLITE_NOTADB`…) en `AppError` au message
 * français : le routeur IPC transmet tel quel tout objet portant `code` et `message`
 * chaînes. Les `AppError` et les erreurs sans `code` textuel (qui deviennent `internal` côté
 * routeur) sont renvoyées inchangées. L'erreur d'origine est gardée, décrite en objet simple
 * (clonable par l'IPC), dans `details`.
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
// Gestionnaire
// ---------------------------------------------------------------------------------------------

export interface LibraryManagerDeps {
  userData: string
  /** `RECOLTOS_HOME` en test, sinon `os.homedir()`. */
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
  /** Sérialise ouverture / bascule / création. */
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
        deps.log?.warn('[library] libraries.json illisible, mis de côté', err)
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
            '[library] entrée de libraries.json invalide, écartée',
            e.success ? 'identifiant en double' : e.error.issues,
          )
        }
      }
    }
    if (!lenient.success || entries.length === 0) {
      deps.log?.warn(
        '[library] libraries.json invalide, mis de côté',
        lenient.success ? 'aucune entrée valide' : lenient.error.issues,
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
      // Garde l'original de côté puis réécrit le registre nettoyé.
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
   * Refuse un dossier choisi situé dans `userData/libraries` ou dans la racine d'une bibliothèque
   * déjà enregistrée : `tmp/` et `items/` y sont gérés (staging, restaurations), un nettoyage par
   * une autre bibliothèque détruirait la bibliothèque imbriquée. Comparaison insensible à la casse.
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

  /** Options d'ouverture communes à `openEntry` et à la réouverture de `closeActive`. */
  const dbOptions = () => ({
    ...(deps.onSlowQuery ? { onSlowQuery: deps.onSlowQuery } : {}),
    ...(deps.busyTimeout !== undefined ? { busyTimeout: deps.busyTimeout } : {}),
    now,
  })

  /**
   * Retour arrière d'une création : retire le dossier créé, ou, s'il existait (vide), seulement
   * ce que la création y a écrit. Les fichiers cachés préexistants sont conservés.
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
      deps.log?.warn('[library] nettoyage de la création annulée impossible', err)
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
   * Ouvre une bibliothèque (dossiers, migrations, repos) et la rend active.
   * Sauf `create` et `default` (créée au premier lancement), une bibliothèque dont le dossier ou
   * `recolt.db` a disparu est refusée : sinon SQLite recréerait une base vide sans prévenir.
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
      deps.log?.info(`[library] ${e.id} migrée v${migration.from} → v${migration.to}`)
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
      // Ouverture incomplète : la base est fermée et aucune bibliothèque n'est active.
      ctx = null
      setActiveLibrary(null)
      try {
        next.db.close()
      } catch {
        // déjà fermée
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
     * Après un `wal_not_empty`, `closeLibrary` a rouvert la base (`closable.db`) : la connexion de
     * `current` est fermée. Le contexte reçoit la nouvelle connexion, et les domaines sont
     * prévenus par `afterOpen` (ils ne doivent pas garder l'ancienne), avant la relance.
     */
    const adoptReopened = async (): Promise<void> => {
      if (closable.db === current.db) return
      current.db = closable.db
      current.repos = createRepos(closable.db, { now })
      try {
        await runAfterOpen(current)
      } catch (err) {
        deps.log?.error('[library] afterOpen en échec après réouverture annulée', err)
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
        // Annulé (wal_not_empty) et base rouverte : la bibliothèque reste active.
        await adoptReopened()
      } else if (!current.db.open) {
        // Annulé et réouverture impossible : la bibliothèque n'est plus utilisable.
        ctx = null
        setActiveLibrary(null)
      }
      throw err
    }
    ctx = null
    setActiveLibrary(null)
  }

  /** Relance workers puis file de jobs après une fermeture suivie d'une ouverture réussie. */
  const restartBackground = async (): Promise<void> => {
    const hooks = aggregatedCloseHooks()
    try {
      await hooks.startWorkers()
      await hooks.resumeJobs()
    } catch (err) {
      deps.log?.error('[library] relance des workers / de la file impossible', err)
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
      deps.log?.error(`[library] ouverture de ${id} impossible`, err)
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

    /** Démarrage : ouvre la bibliothèque active ; repli sur `default` si elle est indisponible. */
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

    /** Fermeture propre (sortie de l'app). */
    close(): Promise<void> {
      return serial(() => closeActive(false))
    },

    /** Ferme pour remplacer le fichier de base (restauration) ; `wal_not_empty` si bloqué. */
    closeForReplace(): Promise<void> {
      return serial(() => closeActive(true))
    },

    /** Rouvre la bibliothèque active après un remplacement (restauration). */
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
     * Crée une bibliothèque puis bascule dessus. `dir` absent : `userData/libraries/<id>` ;
     * sinon le dossier lui-même (inexistant ou vide), refusé s'il est synchronisé.
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
        // Emplacement par défaut (`userData/libraries/<id>`) : pas de contrôle, comme `open()`
        // (l'app y vit déjà ; en dev, `RECOLTOS_USER_DATA` peut être sous un dossier synchronisé).
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

    /** Ajoute un dossier contenant `recolt.db` (ou le retrouve) puis bascule dessus. */
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
          // Retour arrière : une entrée ajoutée par cet appel et inouvrable ne reste pas au registre.
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

    /** Retire du registre (fichiers conservés). La bibliothèque ouverte ne peut pas être retirée. */
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
