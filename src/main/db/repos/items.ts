/**
 * Repo `items` (ARCHI §4.3, §7) : API d'ÉCRITURE gelée (insertion avec médias, upsert par
 * `(origin, origin_id)`, mise à jour, corbeille, masquage, vues, purge transactionnelle avec job
 * `purge.files`). Les lectures de liste (onglets, tris, compteurs) appartiennent à WP-12
 * (`db/queries/**`).
 */
import type Database from 'better-sqlite3'
import { newUuid } from '../../../shared/ids'
import { JOB_PRIORITY } from '../../../shared/jobs'
import type { PostMeta } from '../../../shared/post-meta'
import { MEDIA_FILE_COLUMNS, MEDIA_INSERT_SQL, mediaParams, type NewMedia } from './media'
import { buildSet, idList, repoBase, type ColumnSpec, type RepoOptions } from './util'

export type ItemKindValue = 'image' | 'video' | 'tweet' | 'url'
export type ItemSourceValue = 'local' | 'capture' | 'web' | 'x' | 'instagram' | 'cosmos'
export type TitleSource = 'user' | 'ai' | 'source' | 'import'
export type AiStateValue = 'none' | 'queued' | 'done' | 'failed' | 'skipped'
export type ItemOrigin = 'app' | 'extension' | 'sync' | 'capture' | 'gatheros'

export interface ItemRow {
  id: number
  uuid: string
  kind: ItemKindValue
  source: ItemSourceValue
  external_id: string | null
  source_url: string | null
  author_id: number | null
  title: string | null
  title_source: TitleSource | null
  name_key: string
  notes: string | null
  cover_media_id: number | null
  media_count: number
  palette: string | null
  palette_lab: string | null
  palette_weights: string | null
  color_l: number | null
  color_c: number | null
  color_h: number | null
  color_bucket: number
  color_key: number
  post_meta: string | null
  posted_at: number | null
  ai_title: string | null
  ai_description: string | null
  ai_tags: string | null
  ocr_text: string | null
  ai_prompt: string | null
  ai_state: AiStateValue
  ai_provider: string | null
  ai_model: string | null
  ai_lang: string | null
  ai_excluded: number
  ai_updated_at: number | null
  origin: string
  origin_id: string | null
  legacy_hash: string | null
  created_at: number
  updated_at: number
  viewed_at: number | null
  view_count: number
  hidden_at: number | null
  deleted_at: number | null
}

/** Champs d'un item (camelCase) ; les colonnes JSON reçoivent des valeurs JS. */
export interface ItemFields {
  kind: ItemKindValue
  source: ItemSourceValue
  externalId: string | null
  sourceUrl: string | null
  authorId: number | null
  title: string | null
  titleSource: TitleSource | null
  notes: string | null
  coverMediaId: number | null
  mediaCount: number
  palette: string[] | null
  paletteLab: number[][] | null
  paletteWeights: number[] | null
  colorL: number | null
  colorC: number | null
  colorH: number | null
  colorBucket: number
  postMeta: PostMeta | null
  postedAt: number | null
  aiTitle: string | null
  aiDescription: string | null
  aiTags: string[] | null
  ocrText: string | null
  aiPrompt: string | null
  aiState: AiStateValue
  aiProvider: string | null
  aiModel: string | null
  aiLang: string | null
  aiExcluded: boolean
  aiUpdatedAt: number | null
  origin: ItemOrigin | (string & {})
  originId: string | null
  legacyHash: string | null
  createdAt: number
  updatedAt: number
  viewedAt: number | null
  viewCount: number
  hiddenAt: number | null
  deletedAt: number | null
}

export type NewItem = Partial<ItemFields> & { kind: ItemKindValue; uuid?: string }
export type ItemPatch = Partial<Omit<ItemFields, 'createdAt'>>

const COLUMNS: Readonly<Record<keyof ItemPatch, ColumnSpec>> = {
  kind: { col: 'kind' },
  source: { col: 'source' },
  externalId: { col: 'external_id' },
  sourceUrl: { col: 'source_url' },
  authorId: { col: 'author_id' },
  title: { col: 'title' },
  titleSource: { col: 'title_source' },
  notes: { col: 'notes' },
  coverMediaId: { col: 'cover_media_id' },
  mediaCount: { col: 'media_count' },
  palette: { col: 'palette', kind: 'json' },
  paletteLab: { col: 'palette_lab', kind: 'json' },
  paletteWeights: { col: 'palette_weights', kind: 'json' },
  colorL: { col: 'color_l' },
  colorC: { col: 'color_c' },
  colorH: { col: 'color_h' },
  colorBucket: { col: 'color_bucket' },
  postMeta: { col: 'post_meta', kind: 'json' },
  postedAt: { col: 'posted_at' },
  aiTitle: { col: 'ai_title' },
  aiDescription: { col: 'ai_description' },
  aiTags: { col: 'ai_tags', kind: 'json' },
  ocrText: { col: 'ocr_text' },
  aiPrompt: { col: 'ai_prompt' },
  aiState: { col: 'ai_state' },
  aiProvider: { col: 'ai_provider' },
  aiModel: { col: 'ai_model' },
  aiLang: { col: 'ai_lang' },
  aiExcluded: { col: 'ai_excluded', kind: 'bool' },
  aiUpdatedAt: { col: 'ai_updated_at' },
  origin: { col: 'origin' },
  originId: { col: 'origin_id' },
  legacyHash: { col: 'legacy_hash' },
  updatedAt: { col: 'updated_at' },
  viewedAt: { col: 'viewed_at' },
  viewCount: { col: 'view_count' },
  hiddenAt: { col: 'hidden_at' },
  deletedAt: { col: 'deleted_at' },
}

/** U+FFFF : « sans titre » trié en dernier par le tri Nom (ARCHI §4.3). */
export const UNTITLED_NAME_KEY = '￿'

/** Clé du tri « Nom » : minuscules, sans diacritiques, espaces réduits ; vide → U+FFFF. */
export function nameKey(title: string | null | undefined): string {
  const t = (title ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > 0 ? t : UNTITLED_NAME_KEY
}

const SYNC_SOURCES_SQL = "('x','instagram','cosmos')"

const INSERT_SQL = `INSERT INTO items (
  uuid, kind, source, external_id, source_url, author_id, title, title_source, name_key, notes,
  cover_media_id, media_count, palette, palette_lab, palette_weights, color_l, color_c, color_h,
  color_bucket, post_meta, posted_at, ai_title, ai_description, ai_tags, ocr_text, ai_prompt,
  ai_state, ai_provider, ai_model, ai_lang, ai_excluded, ai_updated_at, origin, origin_id,
  legacy_hash, created_at, updated_at, viewed_at, view_count, hidden_at, deleted_at
) VALUES (
  @uuid, @kind, @source, @external_id, @source_url, @author_id, @title, @title_source, @name_key,
  @notes, @cover_media_id, @media_count, @palette, @palette_lab, @palette_weights, @color_l,
  @color_c, @color_h, @color_bucket, @post_meta, @posted_at, @ai_title, @ai_description, @ai_tags,
  @ocr_text, @ai_prompt, @ai_state, @ai_provider, @ai_model, @ai_lang, @ai_excluded,
  @ai_updated_at, @origin, @origin_id, @legacy_hash, @created_at, @updated_at, @viewed_at,
  @view_count, @hidden_at, @deleted_at
)`

const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v))

function itemParams(i: NewItem, at: number) {
  const created = i.createdAt ?? at
  return {
    uuid: i.uuid ?? newUuid(),
    kind: i.kind,
    source: i.source ?? 'local',
    external_id: i.externalId ?? null,
    source_url: i.sourceUrl ?? null,
    author_id: i.authorId ?? null,
    title: i.title ?? null,
    title_source: i.titleSource ?? null,
    name_key: nameKey(i.title),
    notes: i.notes ?? null,
    cover_media_id: i.coverMediaId ?? null,
    media_count: i.mediaCount ?? 1,
    palette: json(i.palette),
    palette_lab: json(i.paletteLab),
    palette_weights: json(i.paletteWeights),
    color_l: i.colorL ?? null,
    color_c: i.colorC ?? null,
    color_h: i.colorH ?? null,
    color_bucket: i.colorBucket ?? 13,
    post_meta: json(i.postMeta),
    posted_at: i.postedAt ?? null,
    ai_title: i.aiTitle ?? null,
    ai_description: i.aiDescription ?? null,
    ai_tags: json(i.aiTags),
    ocr_text: i.ocrText ?? null,
    ai_prompt: i.aiPrompt ?? null,
    ai_state: i.aiState ?? 'none',
    ai_provider: i.aiProvider ?? null,
    ai_model: i.aiModel ?? null,
    ai_lang: i.aiLang ?? null,
    ai_excluded: i.aiExcluded ? 1 : 0,
    ai_updated_at: i.aiUpdatedAt ?? null,
    origin: i.origin ?? 'app',
    origin_id: i.originId ?? null,
    legacy_hash: i.legacyHash ?? null,
    created_at: created,
    updated_at: i.updatedAt ?? created,
    viewed_at: i.viewedAt ?? null,
    view_count: i.viewCount ?? 0,
    hidden_at: i.hiddenAt ?? null,
    deleted_at: i.deletedAt ?? null,
  }
}

export interface InsertedItem {
  id: number
  uuid: string
  mediaIds: number[]
}

export type UpsertStatus = 'created' | 'existing' | 'updated' | 'tombstoned'

export interface UpsertResult {
  status: UpsertStatus
  id: number | null
  uuid: string | null
}

export interface UpsertOptions {
  /** `ignore` (défaut, politique d'import « ne jamais écraser ») ou `update`. */
  onExisting?: 'ignore' | 'update'
  /** Défaut `true` : un item en pierre tombale n'est jamais recréé. */
  respectTombstones?: boolean
}

export type PurgeMode = 'rm' | 'trash'

export interface PurgeResult {
  purged: number
  files: string[]
  jobId: number | null
}

export function createItemsRepo(db: Database.Database, opts: RepoOptions = {}) {
  const { q, now } = repoBase(db, opts)

  const insertWithMedia = (item: NewItem, media: readonly NewMedia[] = []): InsertedItem => {
    return db.transaction(() => {
      const at = now()
      const params = itemParams(
        { ...item, coverMediaId: null, mediaCount: item.mediaCount ?? media.length },
        at,
      )
      const id = Number(q(INSERT_SQL).run(params).lastInsertRowid)
      const mediaIds: number[] = []
      media.forEach((m, index) => {
        const mp = mediaParams(id, m, m.position ?? index, at)
        const r = q(MEDIA_INSERT_SQL).run(mp)
        mediaIds.push(Number(r.lastInsertRowid))
      })
      if (mediaIds.length > 0) {
        q(
          `UPDATE items SET cover_media_id = (
             SELECT id FROM item_media WHERE item_id = @id ORDER BY position LIMIT 1)
           WHERE id = @id`,
        ).run({ id })
      }
      return { id, uuid: params.uuid, mediaIds }
    })()
  }

  const update = (id: number, patch: ItemPatch): boolean => {
    const full: ItemPatch & { nameKey?: string } = { ...patch }
    if (full.updatedAt === undefined) full.updatedAt = now()
    const set = buildSet(full, COLUMNS)
    if (!set) return false
    let sql = set.sql
    if (patch.title !== undefined) {
      sql += ', name_key = @name_key'
      set.params.name_key = nameKey(patch.title)
    }
    return q(`UPDATE items SET ${sql} WHERE id = @id`).run({ ...set.params, id }).changes > 0
  }

  const filesOf = (ids: readonly number[]): string[] => {
    const cols = MEDIA_FILE_COLUMNS.map((c) => `SELECT ${c} AS f FROM m WHERE ${c} IS NOT NULL`)
    const rows = q(
      `WITH m AS (SELECT * FROM item_media WHERE item_id IN (SELECT value FROM json_each(?)))
       ${cols.join(' UNION ')}`,
    ).all(idList(ids)) as { f: string }[]
    return rows.map((r) => r.f).sort()
  }

  const getByOrigin = (origin: string, originId: string): ItemRow | undefined =>
    q('SELECT * FROM items WHERE origin = ? AND origin_id = ?').get(origin, originId) as
      ItemRow | undefined

  return {
    /** Insère l'item (couverture NULL), ses médias, puis la couverture : une transaction (§4.3). */
    insertWithMedia,

    insert(item: NewItem): InsertedItem {
      return insertWithMedia(item, [])
    },

    /**
     * Idempotence par `(origin, origin_id)` (`ux_items_origin`). Par défaut : n'écrase jamais
     * l'existant et ne ressuscite pas un item en pierre tombale.
     */
    upsertByOrigin(
      item: NewItem & { origin: string; originId: string },
      media: readonly NewMedia[] = [],
      options: UpsertOptions = {},
    ): UpsertResult {
      return db.transaction((): UpsertResult => {
        const existing = getByOrigin(item.origin, item.originId)
        if (existing) {
          if (options.onExisting === 'update') {
            const { kind: _kind, uuid: _uuid, createdAt: _createdAt, ...rest } = item
            update(existing.id, rest)
            return { status: 'updated', id: existing.id, uuid: existing.uuid }
          }
          return { status: 'existing', id: existing.id, uuid: existing.uuid }
        }
        if (options.respectTombstones !== false) {
          const tomb = q(
            "SELECT 1 FROM import_tombstones WHERE origin = ? AND entity = 'item' AND origin_id = ?",
          ).get(item.origin, item.originId)
          if (tomb) return { status: 'tombstoned', id: null, uuid: null }
        }
        const r = insertWithMedia(item, media)
        return { status: 'created', id: r.id, uuid: r.uuid }
      })()
    },

    /** Met à jour les champs fournis (`updated_at` = maintenant, `name_key` suit le titre). */
    update,

    getById(id: number): ItemRow | undefined {
      return q('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined
    },
    getByUuid(uuid: string): ItemRow | undefined {
      return q('SELECT * FROM items WHERE uuid = ?').get(uuid) as ItemRow | undefined
    },
    getByOrigin,
    /** `uuid` → `id` (les uuid inconnus sont absents de la Map). */
    idsByUuids(uuids: readonly string[]): Map<string, number> {
      const rows = q(
        'SELECT uuid, id FROM items WHERE uuid IN (SELECT value FROM json_each(?))',
      ).all(JSON.stringify(uuids)) as { uuid: string; id: number }[]
      return new Map(rows.map((r) => [r.uuid, r.id]))
    },
    countAll(): number {
      return (q('SELECT count(*) AS n FROM items').get() as { n: number }).n
    },
    countLive(): number {
      return (
        q(
          'SELECT count(*) AS n FROM items WHERE deleted_at IS NULL AND hidden_at IS NULL',
        ).get() as { n: number }
      ).n
    },

    /**
     * Corbeille (ARCHI §7) : `deleted_at = now` ; pour X / Instagram / Cosmos avec `external_id`,
     * `sync_dismissed` empêche la sync de le recréer.
     */
    trash(ids: readonly number[], at: number = now()): number {
      return db.transaction(() => {
        const list = idList(ids)
        const n = q(
          `UPDATE items SET deleted_at = @at, updated_at = @at
           WHERE id IN (SELECT value FROM json_each(@list)) AND deleted_at IS NULL`,
        ).run({ at, list }).changes
        q(
          `INSERT OR IGNORE INTO sync_dismissed (source, external_id, dismissed_at)
           SELECT source, external_id, @at FROM items
           WHERE id IN (SELECT value FROM json_each(@list))
             AND source IN ${SYNC_SOURCES_SQL} AND external_id IS NOT NULL`,
        ).run({ at, list })
        return n
      })()
    },

    restore(ids: readonly number[], at: number = now()): number {
      return db.transaction(() => {
        const list = idList(ids)
        q(
          `DELETE FROM sync_dismissed WHERE (source, external_id) IN (
             SELECT source, external_id FROM items
             WHERE id IN (SELECT value FROM json_each(?)) AND external_id IS NOT NULL)`,
        ).run(list)
        return q(
          `UPDATE items SET deleted_at = NULL, updated_at = @at
           WHERE id IN (SELECT value FROM json_each(@list)) AND deleted_at IS NOT NULL`,
        ).run({ at, list }).changes
      })()
    },

    setHidden(ids: readonly number[], hidden: boolean, at: number = now()): number {
      return q(
        `UPDATE items SET hidden_at = @hidden, updated_at = @at
         WHERE id IN (SELECT value FROM json_each(@list))
           AND (hidden_at IS NULL) = @wasVisible`,
      ).run({ hidden: hidden ? at : null, at, list: idList(ids), wasVisible: hidden ? 1 : 0 })
        .changes
    },

    /** Ouverture de la vue détail : `view_count + 1`, `viewed_at = now` (sans toucher `updated_at`). */
    markViewed(id: number, at: number = now()): boolean {
      return (
        q('UPDATE items SET view_count = view_count + 1, viewed_at = ? WHERE id = ?').run(at, id)
          .changes > 0
      )
    },

    /** Fichiers relatifs (originaux et dérivés) des items, sans doublon. */
    filesOf,

    /**
     * Suppression définitive (ARCHI §7) en UNE transaction : liste des fichiers, `DELETE` (cascades,
     * FTS, pierres tombales `item` par trigger) et job `purge.files` (`item_id NULL`).
     * Coût : un seul `DELETE … IN json_each` (≈ 213 ms pour 3 000 items, mesuré) et un payload
     * `purge.files` d'un seul tenant. Les appelants (« Vider la corbeille », purge automatique WP-12)
     * DOIVENT donc découper en lots de 500 ids (`chunks(ids, 500)`) : un appel = une transaction
     * = un job `purge.files`.
     */
    purge(ids: readonly number[], mode: PurgeMode = 'rm'): PurgeResult {
      return db.transaction((): PurgeResult => {
        const files = filesOf(ids)
        const purged = q('DELETE FROM items WHERE id IN (SELECT value FROM json_each(?))').run(
          idList(ids),
        ).changes
        let jobId: number | null = null
        if (purged > 0 && files.length > 0) {
          const at = now()
          jobId = Number(
            q(
              `INSERT INTO jobs (type, item_id, payload, priority, created_at, updated_at)
               VALUES ('purge.files', NULL, ?, ?, ?, ?)`,
            ).run(JSON.stringify({ files, mode, failedOn: [] }), JOB_PRIORITY.BACKGROUND, at, at)
              .lastInsertRowid,
          )
        }
        return { purged, files, jobId }
      })()
    },

    /** Ids des items en corbeille depuis avant `before` (purge automatique, WP-12). */
    trashedBefore(before: number): number[] {
      return (
        q('SELECT id FROM items WHERE deleted_at IS NOT NULL AND deleted_at < ? ORDER BY id').all(
          before,
        ) as { id: number }[]
      ).map((r) => r.id)
    },
  }
}

export type ItemsRepo = ReturnType<typeof createItemsRepo>
