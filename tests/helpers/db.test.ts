import { describe, expect, it } from 'vitest'
import { hasFts5, listMigrations, openTestDb, seedSyntheticLibrary } from './db'
import { makeSyntheticLibrary } from './synthetic-items'
import { makeTmpDir } from './tmpdir'
import { join } from 'node:path'

describe('openTestDb', () => {
  it('applique 0001 et pose user_version ; FTS5 disponible', () => {
    const db = openTestDb()
    const last = listMigrations().at(-1)?.version
    expect(db.pragma('user_version', { simple: true })).toBe(last)
    expect(hasFts5(db)).toBe(true)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['items', 'jobs', 'items_fts']),
    )
    db.close()
  })

  it('base fichier : dossier parent créé, ré-ouverture idempotente', () => {
    const file = join(makeTmpDir('db'), 'sous', 'dossier', 'recolt.db')
    openTestDb({ file }).close()
    const again = openTestDb({ file })
    expect(again.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(1)
    again.close()
  })

  it('seedSyntheticLibrary : 408 éléments, collections, FTS alimentée', () => {
    const db = openTestDb()
    const lib = makeSyntheticLibrary({ trashed: 9, hidden: 1 })
    const { itemIds, collectionIds } = seedSyntheticLibrary(db, lib)
    expect(itemIds).toHaveLength(418)
    expect(collectionIds).toHaveLength(17)
    const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n
    expect(
      count('SELECT count(*) n FROM items WHERE deleted_at IS NULL AND hidden_at IS NULL'),
    ).toBe(408)
    expect(count('SELECT count(*) n FROM items WHERE deleted_at IS NOT NULL')).toBe(9)
    expect(count("SELECT count(*) n FROM items WHERE kind='tweet'")).toBe(54)
    expect(count('SELECT count(*) n FROM collection_items')).toBeGreaterThan(200)
    expect(count('SELECT count(*) n FROM items_fts')).toBe(418)
    // Un texte de post est retrouvé par la recherche plein texte.
    const hit = db.prepare("SELECT rowid FROM items_fts WHERE items_fts MATCH 'cadrage'").all()
    expect(hit.length).toBeGreaterThan(0)
    expect(db.pragma('foreign_key_check')).toEqual([])
    db.close()
  })
})
