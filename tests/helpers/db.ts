/**
 * Bases SQLite de test. `openTestDb()` applique les migrations de `src/main/db/migrations/` dans
 * l'ordre et pose `PRAGMA user_version` (le contrat de `db/migrate.ts`, WP-02) ; tant que `db/open.ts`
 * n'existe pas, ce helper est l'unique chemin des tests vers un schéma à jour.
 * Sous Node pur (vitest) : aucun import d'`electron`.
 */
import Database from 'better-sqlite3'
import { existsSync, readdirSync, readFileSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { MIGRATIONS_DIR } from './paths'
import type { SyntheticLibrary } from './synthetic-items'

export type TestDb = Database.Database

export interface MigrationFile {
  version: number
  name: string
  sql: string
}

/** Migrations `NNNN_nom.sql`, triées par numéro. */
export function listMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({
      version: Number(f.slice(0, 4)),
      name: basename(f, '.sql'),
      sql: readFileSync(join(dir, f), 'utf8'),
    }))
}

export interface OpenTestDbOptions {
  /** Fichier de base ; absent = `:memory:`. Le dossier parent est créé. */
  file?: string
  /** Applique les migrations jusqu'à cette version incluse (défaut : toutes). */
  upTo?: number
  migrationsDir?: string
}

export function openTestDb(options: OpenTestDbOptions = {}): TestDb {
  let db: TestDb
  if (options.file) {
    mkdirSync(dirname(options.file), { recursive: true })
    db = new Database(options.file)
    db.pragma('journal_mode = WAL')
  } else {
    db = new Database(':memory:')
  }
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  const current = db.pragma('user_version', { simple: true }) as number
  for (const m of listMigrations(options.migrationsDir)) {
    if (m.version <= current) continue
    if (options.upTo !== undefined && m.version > options.upTo) break
    db.transaction(() => {
      db.exec(m.sql)
      db.pragma(`user_version = ${m.version}`)
    })()
  }
  return db
}

export function hasFts5(db: TestDb): boolean {
  const rows = db.pragma('compile_options') as { compile_options: string }[]
  return rows.some((r) => /ENABLE_FTS5/.test(r.compile_options))
}

export interface SeedOptions {
  /** Écrit les chemins relatifs des dérivés (`thumb_rel`, `poster_rel`) : à vrai si les fichiers existent. */
  withDerived?: boolean
  /** Origine posée sur items/collections (défaut `app`). */
  origin?: string
}

const ab = (uuid: string): string => uuid.slice(0, 2)

/**
 * Insère une bibliothèque synthétique par SQL direct (les repos de WP-02 et l'ingestion de WP-10
 * n'existent pas encore ; ils reprendront ce rôle). Renvoie les identifiants internes par index.
 */
export function seedSyntheticLibrary(
  db: TestDb,
  lib: SyntheticLibrary,
  options: SeedOptions = {},
): { itemIds: number[]; collectionIds: number[] } {
  const origin = options.origin ?? 'app'
  const insAuthor = db.prepare(
    `INSERT INTO authors(platform, handle, name, avatar_url, avatar_status, updated_at)
     VALUES (@platform, @handle, @name, @avatarUrl, 'none', @now)
     ON CONFLICT(platform, handle) DO UPDATE SET name = excluded.name RETURNING id`,
  )
  const insItem = db.prepare(
    `INSERT INTO items(uuid, kind, source, external_id, source_url, author_id, title, title_source, name_key,
       notes, media_count, palette, palette_lab, color_l, color_c, color_h, color_bucket, post_meta, posted_at,
       origin, origin_id, created_at, updated_at, hidden_at, deleted_at)
     VALUES (@uuid, @kind, @source, @externalId, @sourceUrl, @authorId, @title, @titleSource, @nameKey,
       @notes, @mediaCount, @palette, @paletteLab, @colorL, @colorC, @colorH, @colorBucket, @postMeta, @postedAt,
       @origin, @originId, @createdAt, @createdAt, @hiddenAt, @deletedAt) RETURNING id`,
  )
  const insMedia = db.prepare(
    `INSERT INTO item_media(uuid, item_id, position, media_type, status, file_rel, mime, width, height,
       duration_ms, thumb_rel, poster_rel, created_at)
     VALUES (@uuid, @itemId, @position, @mediaType, 'ok', @fileRel, @mime, @width, @height,
       @durationMs, @thumbRel, @posterRel, @createdAt) RETURNING id`,
  )
  const setCover = db.prepare('UPDATE items SET cover_media_id = ? WHERE id = ?')
  const insColl = db.prepare(
    `INSERT INTO collections(uuid, name, order_index, origin, created_at, updated_at)
     VALUES (@uuid, @name, @order, @origin, @now, @now) RETURNING id`,
  )
  const insMember = db.prepare(
    'INSERT OR IGNORE INTO collection_items(collection_id, item_id, added_at, order_index) VALUES (?, ?, ?, ?)',
  )
  const insTag = db.prepare(
    'INSERT INTO tags(uuid, name, created_at) VALUES (?, ?, ?) RETURNING id',
  )
  const insItemTag = db.prepare(
    "INSERT OR IGNORE INTO item_tags(item_id, tag_id, source, created_at) VALUES (?, ?, 'user', ?)",
  )

  const itemIds: number[] = []
  const collectionIds: number[] = []
  const now = lib.items[0]?.createdAt ?? Date.now()

  db.transaction(() => {
    for (const it of lib.items) {
      const author = it.author
        ? (insAuthor.get({
            platform: it.author.platform,
            handle: it.author.handle,
            name: it.author.name,
            avatarUrl: `https://example.test/avatar/${it.author.handle}.jpg`,
            now,
          }) as { id: number })
        : null
      const row = insItem.get({
        uuid: it.uuid,
        kind: it.kind,
        source: it.source,
        externalId: it.externalId,
        sourceUrl: it.sourceUrl,
        authorId: author?.id ?? null,
        title: it.title,
        titleSource: it.title ? 'import' : null,
        nameKey: it.title ? it.title.toLocaleLowerCase('fr') : String.fromCharCode(65535),
        notes: it.notes,
        mediaCount: Math.max(1, it.media.length),
        palette: it.palette ? JSON.stringify(it.palette) : null,
        paletteLab: it.paletteLab ? JSON.stringify(it.paletteLab) : null,
        colorL: it.colorL,
        colorC: it.colorC,
        colorH: it.colorH,
        colorBucket: it.colorBucket,
        postMeta: it.postMeta ? JSON.stringify(it.postMeta) : null,
        postedAt: it.postMeta?.postedAt ?? null,
        origin,
        originId: origin === 'app' ? null : String(it.index),
        createdAt: it.createdAt,
        hiddenAt: it.hiddenAt,
        deletedAt: it.trashedAt,
      }) as { id: number }
      itemIds[it.index] = row.id
      let first: number | null = null
      for (const m of it.media) {
        const mid = insMedia.get({
          uuid: m.uuid,
          itemId: row.id,
          position: m.position,
          mediaType: m.mediaType,
          fileRel: `items/${ab(m.uuid)}/${m.uuid}.${m.ext}`,
          mime: m.mime,
          width: m.width,
          height: m.height,
          durationMs: m.durationMs,
          thumbRel: options.withDerived ? `thumbs/${ab(m.uuid)}/${m.uuid}.webp` : null,
          posterRel:
            options.withDerived && m.mediaType === 'video'
              ? `posters/${ab(m.uuid)}/${m.uuid}.jpg`
              : null,
          createdAt: it.createdAt,
        }) as { id: number }
        first ??= mid.id
      }
      if (first !== null) setCover.run(first, row.id)
    }

    lib.collections.forEach((c, order) => {
      const cid = (
        insColl.get({ uuid: c.uuid, name: c.name, order, origin, now }) as { id: number }
      ).id
      collectionIds.push(cid)
      c.itemIndexes.forEach((idx, pos) => {
        const iid = itemIds[idx]
        const it = lib.items[idx]
        if (iid !== undefined && it) insMember.run(cid, iid, it.createdAt + 60_000, pos)
      })
    })

    for (const t of lib.tags) {
      const tid = (insTag.get(t.uuid, t.name, now) as { id: number }).id
      for (const idx of t.itemIndexes) {
        const iid = itemIds[idx]
        if (iid !== undefined) insItemTag.run(iid, tid, now)
      }
    }
  })()

  return { itemIds, collectionIds }
}

/** Base d'une bibliothèque d'un `userData` (par défaut la bibliothèque `default`, cf. `make-fixtures`). */
export const libraryDbPath = (userData: string, libraryId = 'default'): string =>
  join(userData, 'libraries', libraryId, 'recolt.db')

/**
 * Ouvre une base EXISTANTE en lecture seule (vérifier ce que l'app a écrit, QA §6.1). Aucune
 * migration, aucune écriture : l'app peut tourner en parallèle (WAL). À fermer par l'appelant.
 */
export function openDbReadonly(file: string): TestDb {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  db.pragma('busy_timeout = 5000')
  return db
}

/** Vrai si le chemin d'une base existe (aide pour les tests de fixtures). */
export const dbExists = (file: string): boolean => existsSync(file)
