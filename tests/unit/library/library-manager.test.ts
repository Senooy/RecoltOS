import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { events } from '../../../src/shared/ipc'
import {
  getActiveLibrary,
  registerLibraryLifecycle,
  requireLibrary,
  resetLibraryContextForTests,
} from '../../../src/main/library/library-context'
import {
  createLibraryManager,
  isSyncedFolder,
  type LibraryManager,
  type LibraryManagerDeps,
} from '../../../src/main/library/library-manager'

let base: string
let userData: string
let home: string
let emit: ReturnType<typeof vi.fn<NonNullable<LibraryManagerDeps['emit']>>>
type LogFn = (...a: unknown[]) => void
let log: {
  info: ReturnType<typeof vi.fn<LogFn>>
  warn: ReturnType<typeof vi.fn<LogFn>>
  error: ReturnType<typeof vi.fn<LogFn>>
}
let managers: LibraryManager[]
let clock: number

function make(extra: Partial<LibraryManagerDeps> = {}): LibraryManager {
  const m = createLibraryManager({
    userData,
    home,
    now: () => clock++,
    emit,
    log,
    busyTimeout: 20,
    checkpointBusyTimeoutMs: 10,
    ...extra,
  })
  managers.push(m)
  return m
}

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'recolt-lib-')))
  userData = path.join(base, 'userData')
  home = path.join(base, 'home')
  fs.mkdirSync(home, { recursive: true })
  emit = vi.fn()
  log = { info: vi.fn<LogFn>(), warn: vi.fn<LogFn>(), error: vi.fn<LogFn>() }
  managers = []
  clock = 1_790_000_000_000
  resetLibraryContextForTests()
})
afterEach(async () => {
  for (const m of managers) await m.close().catch(() => undefined)
  resetLibraryContextForTests()
  fs.rmSync(base, { recursive: true, force: true })
})

const registryFile = () => path.join(userData, 'libraries.json')
const readRegistry = () =>
  JSON.parse(fs.readFileSync(registryFile(), 'utf8')) as {
    active: string
    libraries: { id: string; name: string; path: string | null }[]
  }

describe('ouverture et registre', () => {
  it('premier lancement : bibliothèque « default », dossiers, base migrée, contexte actif', async () => {
    const m = make()
    expect(() => requireLibrary()).toThrow(expect.objectContaining({ code: 'library_unavailable' }))
    const ctx = await m.open()
    expect(await m.open()).toBe(ctx)
    expect(ctx.id).toBe('default')
    expect(ctx.root).toBe(path.join(userData, 'libraries', 'default'))
    for (const d of [
      'items',
      'thumbs',
      'large',
      'previews',
      'remote',
      'snapshots',
      'tmp',
      'spaces/assets',
    ]) {
      expect(fs.statSync(path.join(ctx.root, d)).isDirectory(), d).toBe(true)
    }
    expect(ctx.db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(ctx.db.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(getActiveLibrary()).toBe(ctx)
    expect(readRegistry()).toEqual({
      version: 1,
      active: 'default',
      libraries: [
        {
          id: 'default',
          name: 'Bibliothèque',
          path: null,
          createdAt: expect.any(Number) as number,
        },
      ],
    })
    ctx.repos.items.insert({ kind: 'image' })
    ctx.repos.items.insert({ kind: 'image', hiddenAt: 1 })
    expect(m.list()).toEqual({
      active: 'default',
      libraries: [{ id: 'default', name: 'Bibliothèque', path: null, itemCount: 1 }],
    })
    expect(m.active()).toBe(ctx)
  })

  it('libraries.json corrompu ou invalide : mis de côté, registre par défaut', async () => {
    fs.mkdirSync(userData, { recursive: true })
    fs.writeFileSync(registryFile(), '{pas du json')
    await make().open()
    expect(readRegistry().active).toBe('default')
    expect(fs.readdirSync(userData).some((f) => f.startsWith('libraries.json.bad-'))).toBe(true)
    await managers[0]!.close()
    fs.writeFileSync(registryFile(), JSON.stringify({ version: 2 }))
    await make().open()
    expect(log.warn).toHaveBeenCalledTimes(2)
  })

  it('entrée invalide : seule cette entrée est écartée, les autres bibliothèques sont conservées', async () => {
    const ext = path.join(base, 'ext')
    fs.mkdirSync(ext, { recursive: true })
    fs.mkdirSync(userData, { recursive: true })
    fs.writeFileSync(
      registryFile(),
      JSON.stringify({
        version: 1,
        active: 'default',
        libraries: [
          { id: 'default', name: 'Bibliothèque', path: null, createdAt: 1 },
          { id: 'lbad', name: '', path: null, createdAt: 2 },
          { id: 'lext', name: 'Externe', path: ext, createdAt: 3 },
        ],
      }),
    )
    const m = make()
    await m.open()
    expect(m.registry().libraries.map((l) => l.id)).toEqual(['default', 'lext'])
    expect(readRegistry().libraries.map((l) => l.id)).toEqual(['default', 'lext'])
    expect(fs.readdirSync(userData).some((f) => f.startsWith('libraries.json.bad-'))).toBe(true)
    expect(log.warn).toHaveBeenCalled()
  })

  it('active inconnue → première de la liste ; active indisponible → repli sur default', async () => {
    const ext = path.join(base, 'ext')
    fs.mkdirSync(userData, { recursive: true })
    fs.writeFileSync(
      registryFile(),
      JSON.stringify({
        version: 1,
        active: 'lgone',
        libraries: [{ id: 'lext', name: 'Externe', path: ext, createdAt: 1 }],
      }),
    )
    const ctx = await make().open()
    expect(ctx.id).toBe('default')
    expect(log.error).toHaveBeenCalled()
    expect(readRegistry().active).toBe('default')
    expect(readRegistry().libraries.map((l) => l.id)).toEqual(['default', 'lext'])
  })
})

describe('création et bascule (library.switched)', () => {
  it('création → bascule → library.switched ; retour à default', async () => {
    const m = make()
    const first = await m.open()
    first.repos.items.insert({ kind: 'image' })
    const created = await m.create({ name: '  Travail ' })
    expect(created).toMatchObject({ name: 'Travail', path: null, itemCount: 0 })
    expect(created.id).toMatch(/^l[0-9a-z]+$/)
    expect(events['library.switched'].safeParse({ libraryId: created.id }).success).toBe(true)
    expect(emit).toHaveBeenCalledWith('library.switched', { libraryId: created.id })
    expect(first.db.open).toBe(false)
    expect(requireLibrary().id).toBe(created.id)
    expect(readRegistry().active).toBe(created.id)
    expect(m.list().libraries.map((l) => [l.id, l.itemCount])).toEqual([
      ['default', 1],
      [created.id, 0],
    ])

    emit.mockClear()
    await m.switch(created.id)
    expect(emit).not.toHaveBeenCalled()
    await m.switch('default')
    expect(emit).toHaveBeenCalledWith('library.switched', { libraryId: 'default' })
    expect(requireLibrary().repos.items.countLive()).toBe(1)
    await expect(m.switch('linconnue')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('emplacement par défaut jamais refusé, même si userData est dans un dossier synchronisé', async () => {
    userData = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'dev-userData')
    const m = make()
    await m.open()
    await expect(m.create({ name: 'Dev' })).resolves.toMatchObject({ name: 'Dev', path: null })
  })

  it('création dans un dossier choisi : vide accepté, non vide ou déjà bibliothèque refusés', async () => {
    const m = make()
    await m.open()
    const dir = path.join(base, 'choisi')
    const lib = await m.create({ name: 'Ext', path: dir })
    expect(lib.path).toBe(dir)
    expect(fs.existsSync(path.join(dir, 'recolt.db'))).toBe(true)
    await expect(m.create({ name: 'Bis', path: dir })).rejects.toMatchObject({ code: 'conflict' })
    const full = path.join(base, 'plein')
    fs.mkdirSync(full)
    fs.writeFileSync(path.join(full, 'photo.jpg'), '')
    await expect(m.create({ name: 'Plein', path: full })).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(readRegistry().libraries).toHaveLength(2)
  })

  it.each([
    ['iCloud Drive', 'Library/Mobile Documents/com~apple~CloudDocs/RecoltOS'],
    ['CloudStorage', 'Library/CloudStorage/Dropbox/Libs'],
    ['Dropbox', 'Dropbox/RecoltOS'],
    ['Dropbox (Équipe)', 'Dropbox (Équipe)/RecoltOS'],
  ])('dossier synchronisé refusé : %s', async (_label, rel) => {
    const m = make()
    await m.open()
    emit.mockClear()
    await expect(m.create({ name: 'Nuage', path: path.join(home, rel) })).rejects.toMatchObject({
      code: 'synced_folder_refused',
    })
    expect(emit).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(home, rel))).toBe(false)
    expect(readRegistry().libraries).toHaveLength(1)
  })
})

describe('isSyncedFolder', () => {
  it('marqueur .dropbox, Bureau / Documents synchronisés par iCloud, dossier local', () => {
    const marked = path.join(base, 'marque')
    fs.mkdirSync(marked)
    fs.writeFileSync(path.join(marked, '.dropbox'), '')
    expect(isSyncedFolder(path.join(marked, 'a', 'b'), home)).toBe(true)
    const docs = path.join(home, 'Documents', 'Libs')
    expect(isSyncedFolder(docs, home)).toBe(false)
    fs.mkdirSync(
      path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Documents'),
      {
        recursive: true,
      },
    )
    expect(isSyncedFolder(docs, home)).toBe(true)
    expect(isSyncedFolder(path.join(home, 'Pictures', 'Libs'), home)).toBe(false)
    expect(isSyncedFolder(path.join(base, 'local'))).toBe(false)
  })

  it('lien symbolique vers iCloud Drive résolu', () => {
    const icloud = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')
    fs.mkdirSync(icloud, { recursive: true })
    const link = path.join(base, 'raccourci')
    fs.symlinkSync(icloud, link)
    expect(isSyncedFolder(path.join(link, 'Lib'), home)).toBe(true)
  })
})

describe('dossier existant, renommage, retrait', () => {
  it('addExisting : enregistre puis bascule ; idempotent ; dossier sans base refusé', async () => {
    const m = make()
    await m.open()
    const dir = path.join(base, 'ailleurs')
    const lib = await m.create({ name: 'Ailleurs', path: dir })
    await m.switch('default')
    // Un second gestionnaire (autre registre) découvre le dossier.
    const reg = registryFile()
    const again = await m.addExisting(dir)
    expect(again.id).toBe(lib.id)
    expect(requireLibrary().id).toBe(lib.id)
    fs.writeFileSync(
      reg,
      JSON.stringify({
        ...readRegistry(),
        libraries: readRegistry().libraries.filter((l) => l.id !== lib.id),
        active: 'default',
      }),
    )
    await m.close()
    const m2 = make()
    await m2.open()
    const found = await m2.addExisting(dir)
    expect(found).toMatchObject({ name: 'ailleurs', path: dir })
    await expect(m2.addExisting(path.join(base, 'vide'))).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(
      m2.addExisting(path.join(home, 'Library', 'CloudStorage', 'x')),
    ).rejects.toMatchObject({ code: 'synced_folder_refused' })
  })

  it('noms vides ou trop longs refusés (validation) ; le registre reste relisible', async () => {
    const m = make()
    await m.open()
    await expect(m.create({ name: '   ' })).rejects.toMatchObject({ code: 'validation' })
    await expect(m.create({ name: 'x'.repeat(101) })).rejects.toMatchObject({ code: 'validation' })
    expect(() => m.rename('default', '  ')).toThrow(expect.objectContaining({ code: 'validation' }))
    expect(m.registry().libraries.map((l) => l.name)).toEqual(['Bibliothèque'])
    expect(readRegistry().libraries).toHaveLength(1)
  })

  it('renommage, retrait (fichiers conservés), bibliothèque ouverte non retirable', async () => {
    const m = make()
    await m.open()
    const other = await m.create({ name: 'Autre' })
    expect(m.rename(other.id, ' Projet ')).toMatchObject({ name: 'Projet' })
    expect(requireLibrary().name).toBe('Projet')
    expect(m.rename('default', 'Perso').name).toBe('Perso')
    expect(() => m.remove(other.id)).toThrow(expect.objectContaining({ code: 'conflict' }))
    const root = m.rootOf(other.id)
    await m.switch('default')
    m.remove(other.id)
    expect(fs.existsSync(path.join(root, 'recolt.db'))).toBe(true)
    expect(m.list().libraries.map((l) => l.id)).toEqual(['default'])
    expect(() => m.remove(other.id)).toThrow(expect.objectContaining({ code: 'not_found' }))
    expect(m.registry().libraries[0]?.name).toBe('Perso')
  })
})

describe('cycle de vie : accroches, échecs, remplacement', () => {
  it('pause / arrêt avant fermeture, afterOpen après ouverture', async () => {
    const calls: string[] = []
    const off = registerLibraryLifecycle('jobs', {
      pauseJobs: (ms) => void calls.push(`pause:${ms}`),
      stopWorkers: () => void calls.push('stop'),
      afterOpen: (ctx) => void calls.push(`open:${ctx.id}`),
    })
    const m = make()
    await m.open()
    const lib = await m.create({ name: 'B' })
    expect(calls).toEqual(['open:default', 'pause:10000', 'stop', `open:${lib.id}`])
    off()
    off()
    await m.switch('default')
    expect(calls).toHaveLength(4)
  })

  it('bascule, repli et reopen relancent les workers puis la file (pause → stop → afterOpen → start → resume)', async () => {
    const calls: string[] = []
    registerLibraryLifecycle('all', {
      pauseJobs: () => void calls.push('pause'),
      stopWorkers: () => void calls.push('stop'),
      startWorkers: () => void calls.push('start'),
      resumeJobs: () => void calls.push('resume'),
      afterOpen: (ctx) => void calls.push(`open:${ctx.id}`),
    })
    const m = make()
    await m.open()
    expect(calls).toEqual(['open:default'])
    calls.length = 0
    const lib = await m.create({ name: 'B' })
    expect(calls).toEqual(['pause', 'stop', `open:${lib.id}`, 'start', 'resume'])

    calls.length = 0
    await m.reopen()
    expect(calls).toEqual(['pause', 'stop', `open:${lib.id}`, 'start', 'resume'])

    // Repli sur la bibliothèque précédente : relancée aussi.
    const dir = path.join(base, 'amovible')
    const ext = await m.create({ name: 'Disque', path: dir })
    await m.switch('default')
    fs.rmSync(dir, { recursive: true })
    calls.length = 0
    await expect(m.switch(ext.id)).rejects.toMatchObject({ code: 'library_unavailable' })
    expect(calls).toEqual(['pause', 'stop', 'open:default', 'start', 'resume'])

    // Restauration : closeForReplace puis reopen relance une seule fois.
    calls.length = 0
    await m.closeForReplace()
    await m.reopen()
    expect(calls).toEqual(['pause', 'stop', 'open:default', 'start', 'resume'])
  })

  it('échec d’ouverture de la cible : retour à la bibliothèque précédente', async () => {
    const m = make()
    await m.open()
    const dir = path.join(base, 'amovible')
    const lib = await m.create({ name: 'Disque', path: dir })
    await m.switch('default')
    fs.rmSync(dir, { recursive: true })
    emit.mockClear()
    await expect(m.switch(lib.id)).rejects.toMatchObject({ code: 'library_unavailable' })
    expect(requireLibrary().id).toBe('default')
    expect(emit).not.toHaveBeenCalled()
    expect(readRegistry().active).toBe('default')
  })

  it('closeForReplace bloqué par un lecteur : wal_not_empty, la bibliothèque reste utilisable', async () => {
    const m = make()
    const ctx = await m.open()
    for (let i = 0; i < 5; i++) ctx.repos.items.insert({ kind: 'image' })
    const reader = new Database(ctx.paths.db)
    reader.exec('BEGIN')
    reader.prepare('SELECT count(*) FROM items').get()
    await expect(m.closeForReplace()).rejects.toMatchObject({ code: 'wal_not_empty' })
    expect(requireLibrary().db.open).toBe(true)
    expect(requireLibrary().repos.items.countLive()).toBe(5)
    reader.exec('COMMIT')
    reader.close()
    await m.closeForReplace()
    expect(getActiveLibrary()).toBeNull()
    expect(fs.existsSync(ctx.paths.wal) ? fs.statSync(ctx.paths.wal).size : 0).toBe(0)
    const reopened = await m.reopen()
    expect(reopened.repos.items.countLive()).toBe(5)
    expect(emit).toHaveBeenLastCalledWith('library.switched', { libraryId: 'default' })
  })

  it('journal des requêtes lentes transmis aux bases ouvertes', async () => {
    const onSlowQuery = vi.fn()
    const ctx = await make({ onSlowQuery }).open()
    ctx.repos.items.countLive()
    expect(onSlowQuery).not.toHaveBeenCalled()
  })
})
