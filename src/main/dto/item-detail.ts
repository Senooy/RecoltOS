/**
 * DTO `ItemDetail` : carte + notes, post complet (fil, post cité), slides, collections,
 * tags, palette, champs IA. Construit par main ; aucune URL http(s) de ressource.
 */
import type Database from 'better-sqlite3'
import type { ItemDetail, PostDetailView } from '../../shared/dto/items'
import { AppError } from '../../shared/errors'
import { parsePostMeta } from '../../shared/post-meta'
import { cardRowsByUuid } from '../db/queries/list'
import type { ItemRow } from '../db/repos/items'
import type { MediaRow } from '../db/repos/media'
import { resolveMediaUrls } from '../protocol/urls'
import { postView, remoteImageUrls, toItemCard, type DtoLib } from './item-card'
import { mt } from '../i18n'

const HEX = /^#[0-9a-f]{6}$/i

export function toItemDetail(lib: DtoLib, db: Database.Database, uuid: string): ItemDetail {
  const row = cardRowsByUuid(db, [uuid])[0]
  const item = db.prepare('SELECT * FROM items WHERE uuid = ?').get(uuid) as ItemRow | undefined
  if (!row || !item) throw new AppError('not_found', mt().errors.itemNotFound)
  const card = toItemCard(lib, row)
  const media = db
    .prepare('SELECT * FROM item_media WHERE item_id = ? ORDER BY position')
    .all(item.id) as MediaRow[]
  const meta = parsePostMeta(item.post_meta)
  let post: PostDetailView | null = null
  const base = postView(lib, meta, {
    name: row.a_name,
    handle: row.a_handle,
    avatarRel: row.a_avatar_rel,
    avatarStatus: row.a_avatar_status,
    updatedAt: row.a_updated_at,
  })
  if (base && meta) {
    post = {
      ...base,
      text: meta.text,
      postedAt: meta.postedAt,
      thread: meta.thread.map((t) => ({
        text: t.text,
        imageUrls: remoteImageUrls(
          lib,
          t.media.map((m) => m.remoteUrl),
        ),
      })),
    }
  }
  let palette: string[] | null = null
  try {
    const v: unknown = item.palette ? JSON.parse(item.palette) : null
    if (Array.isArray(v))
      palette = v.filter((h): h is string => typeof h === 'string' && HEX.test(h))
  } catch {
    palette = null
  }
  const named = (sql: string) => db.prepare(sql).all(item.id) as { uuid: string; name: string }[]
  return {
    ...card,
    notes: item.notes,
    sourceUrl: item.source_url,
    externalId: item.external_id,
    post,
    slides: media
      .filter((m) => m.status !== 'missing')
      .map((m) => {
        const u = resolveMediaUrls(lib.id, m)
        return {
          uuid: m.uuid,
          type: m.media_type,
          status: m.status,
          thumbUrl: u.thumbUrl,
          largeUrl: u.largeUrl,
          originalUrl: u.originalUrl,
          width: m.width && m.width > 0 ? m.width : null,
          height: m.height && m.height > 0 ? m.height : null,
        }
      }),
    collections: named(
      `SELECT c.uuid, c.name FROM collection_items ci JOIN collections c ON c.id = ci.collection_id
       WHERE ci.item_id = ? ORDER BY c.order_index, c.id`,
    ),
    tags: named(
      `SELECT t.uuid, t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ? ORDER BY t.name`,
    ),
    palette: palette && palette.length > 0 ? palette : null,
    ocrText: item.ocr_text,
    aiDescription: item.ai_description,
    aiPrompt: item.ai_prompt,
    aiState: item.ai_state,
    aiProvider: item.ai_provider,
    aiLang: item.ai_lang,
    fileSize: media[0]?.file_size ?? null,
    addedAt: item.created_at,
    hiddenAt: item.hidden_at,
    deletedAt: item.deleted_at,
    aiExcluded: item.ai_excluded === 1,
    ...aiJobState(db, item.id, item.ai_state),
  }
}

/** Job IA actif et dernière erreur (panneau Détails). */
function aiJobState(
  db: Database.Database,
  itemId: number,
  aiState: string,
): Pick<ItemDetail, 'aiJob' | 'aiError'> {
  const active = db
    .prepare(
      `SELECT type, state, last_error FROM jobs WHERE item_id = ? AND type IN ('ai.enrich','ai.prompt')
       AND state IN ('queued','running') ORDER BY (state = 'running') DESC, id DESC LIMIT 1`,
    )
    .get(itemId) as
    | { type: 'ai.enrich' | 'ai.prompt'; state: 'queued' | 'running'; last_error: string | null }
    | undefined
  const parse = (s: string | null) => {
    if (!s) return null
    try {
      const e = JSON.parse(s) as { code?: unknown; message?: unknown }
      return typeof e.code === 'string' && typeof e.message === 'string'
        ? { code: e.code, message: e.message }
        : null
    } catch {
      return null
    }
  }
  if (active)
    return { aiJob: { type: active.type, state: active.state }, aiError: parse(active.last_error) }
  if (aiState !== 'failed') return { aiJob: null, aiError: null }
  const failed = db
    .prepare(
      `SELECT last_error FROM jobs WHERE item_id = ? AND type = 'ai.enrich' AND state = 'failed'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(itemId) as { last_error: string | null } | undefined
  return {
    aiJob: null,
    aiError: parse(failed?.last_error ?? null) ?? { code: 'failed', message: 'analyse impossible' },
  }
}
