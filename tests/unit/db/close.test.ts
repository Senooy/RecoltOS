import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkpointTruncate,
  closeLibrary,
  walFile,
  type ClosableLibrary,
} from '../../../src/main/db/close'
import { openLibraryDb } from '../../../src/main/db/open'
import { tmpDir } from './helpers'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const c of cleanups.splice(0).reverse()) c()
})

function setup() {
  const root = tmpDir()
  const { db, file } = openLibraryDb(root, { busyTimeout: 20 })
  const order: string[] = []
  const hooks = {
    pauseJobs: vi.fn((ms: number) => {
      order.push(`pause:${ms}`)
    }),
    stopWorkers: vi.fn(async () => {
      order.push('stop')
      await Promise.resolve()
    }),
    startWorkers: vi.fn(() => {
      order.push('start')
    }),
    resumeJobs: vi.fn(() => {
      order.push('resume')
    }),
  }
  const reopen = vi.fn(() => openLibraryDb(root, { busyTimeout: 20 }).db)
  const warn = vi.fn()
  const lib: ClosableLibrary = { db, dbFile: file, hooks, reopen, log: { warn } }
  cleanups.push(() => {
    if (lib.db.open) lib.db.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
  // Écritures : le -wal n'est pas vide.
  for (let i = 0; i < 20; i++) {
    db.prepare(
      "INSERT INTO items (uuid, kind, created_at, updated_at) VALUES (?, 'image', 1, 1)",
    ).run(`u${i}`)
  }
  expect(fs.statSync(walFile(file)).size).toBeGreaterThan(0)
  return { root, file, lib, hooks, order, reopen, warn }
}

describe('closeLibrary', () => {
  it('pause des jobs → arrêt des workers → checkpoint TRUNCATE → fermeture ; -wal vide', async () => {
    const { lib, file, order, reopen } = setup()
    const res = await closeLibrary(lib, { forReplace: true, jobsDrainTimeoutMs: 1234 })
    expect(order).toEqual(['pause:1234', 'stop'])
    expect(res.checkpoint?.busy).toBe(0)
    expect(lib.db.open).toBe(false)
    expect(fs.existsSync(walFile(file)) ? fs.statSync(walFile(file)).size : 0).toBe(0)
    expect(reopen).not.toHaveBeenCalled()
    // La base remplacée peut être relue sans perte.
    const check = new Database(file, { readonly: true })
    expect(check.prepare('SELECT count(*) AS n FROM items').get()).toEqual({ n: 20 })
    check.close()
  })

  it('forReplace : un lecteur qui bloque le checkpoint → wal_not_empty, base rouverte, file relancée', async () => {
    const { lib, file, order, reopen, warn } = setup()
    // Lecteur simulé : transaction de lecture ouverte sur une seconde connexion.
    const reader = new Database(file)
    cleanups.push(() => reader.close())
    reader.exec('BEGIN')
    reader.prepare('SELECT count(*) FROM items').get()
    const before = lib.db
    await expect(
      closeLibrary(lib, { forReplace: true, checkpointBusyTimeoutMs: 10 }),
    ).rejects.toMatchObject({
      code: 'wal_not_empty',
      details: expect.objectContaining({ busy: 1 }) as unknown,
    })
    expect(before.open).toBe(false)
    expect(reopen).toHaveBeenCalledTimes(1)
    expect(lib.db).not.toBe(before)
    expect(lib.db.open).toBe(true)
    expect(order).toEqual(['pause:10000', 'stop', 'start', 'resume'])
    expect(warn).toHaveBeenCalled()
    expect(fs.statSync(walFile(file)).size).toBeGreaterThan(0)
    reader.exec('COMMIT')
    // Lecteur libéré : la fermeture aboutit.
    await expect(closeLibrary(lib, { forReplace: true })).resolves.toMatchObject({
      checkpoint: { busy: 0 },
    })
  })

  it('forReplace : réouverture impossible → workers et file non relancés, wal_not_empty levée', async () => {
    const { lib, file, order, hooks, warn } = setup()
    lib.reopen = () => {
      throw new Error('base illisible')
    }
    const reader = new Database(file)
    cleanups.push(() => reader.close())
    reader.exec('BEGIN')
    reader.prepare('SELECT count(*) FROM items').get()
    await expect(
      closeLibrary(lib, { forReplace: true, checkpointBusyTimeoutMs: 10 }),
    ).rejects.toMatchObject({ code: 'wal_not_empty' })
    expect(order).toEqual(['pause:10000', 'stop'])
    expect(hooks.startWorkers).not.toHaveBeenCalled()
    expect(hooks.resumeJobs).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    expect(lib.db.open).toBe(false)
    reader.exec('COMMIT')
  })

  it('sans forReplace : un checkpoint bloqué est seulement journalisé', async () => {
    const { lib, file } = setup()
    const reader = new Database(file)
    cleanups.push(() => reader.close())
    reader.exec('BEGIN')
    reader.prepare('SELECT 1 FROM items LIMIT 1').get()
    const res = await closeLibrary(lib, { forReplace: false, checkpointBusyTimeoutMs: 5 })
    expect(res.checkpoint?.busy).toBe(1)
    expect(lib.db.open).toBe(false)
    reader.exec('COMMIT')
  })

  it('sans hooks ni reopen ; base déjà fermée ; checkpointTruncate', async () => {
    const root = tmpDir()
    const { db, file } = openLibraryDb(root)
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }))
    expect(checkpointTruncate(db)).toMatchObject({ busy: 0 })
    db.close()
    await expect(closeLibrary({ db, dbFile: file }, { forReplace: true })).resolves.toEqual({
      checkpoint: null,
    })
    // -wal artificiellement non vide et aucune réouverture possible : l'erreur est levée quand même.
    fs.writeFileSync(walFile(file), 'x')
    await expect(closeLibrary({ db, dbFile: file }, { forReplace: true })).rejects.toMatchObject({
      code: 'wal_not_empty',
    })
    expect(path.basename(walFile(file))).toBe('recolt.db-wal')
  })
})
