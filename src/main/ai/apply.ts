/**
 * Application des résultats en UNE transaction, conditionnée à `deleted_at IS NULL` :
 * description, OCR (si non vide, ou si `force`), titre IA (`ai_title` toujours ; `title` selon la
 * politique), tags `source='ai'` (les tags `user` / `import` ne sont jamais touchés), `ai_lang='fr'`.
 * La FTS suit par les triggers de 0001 (`items` : title, ocr_text, ai_description, ai_tags ;
 * `item_tags`). Règles du titre :
 * - `title_source = 'user'` : JAMAIS écrasé ;
 * - `'import'` : remplacé seulement en politique `always` ou sur demande explicite (« Régénérer le
 *   titre ») ;
 * - vide, `'source'` (titre de page) ou `'ai'` : remplacé si `autoName`.
 */
import { AI_FIELDS, type AiAnalysis, type AiCallMeta, type AiField } from '../../shared/ai-types'
import type { ItemRow } from '../db/repos/items'
import type { LibraryContext } from '../library/library-context'
import { filterTags } from './tags'

export interface ApplyOptions {
  fields?: readonly AiField[]
  /** Écrire le titre (autoName, analyse manuelle) ; faux pour « autoAnalyzeOnSave » seul. */
  autoName: boolean
  titlePolicy: 'empty' | 'always'
  /** Demande explicite de l'utilisateur sur le titre (bouton « Régénérer le titre »). */
  explicitTitle?: boolean
  force?: boolean
  vocabulary: readonly string[]
  now: number
}

export function shouldWriteTitle(
  item: Pick<ItemRow, 'title' | 'title_source'>,
  o: ApplyOptions,
): boolean {
  if (item.title_source === 'user') return false
  if (o.explicitTitle) return true
  if (!o.autoName) return false
  if (o.titlePolicy === 'always') return true
  if (!item.title || item.title.trim() === '') return true
  return item.title_source === 'source' || item.title_source === 'ai' || item.title_source === null
}

/** Renvoie l'item mis à jour, ou `null` s'il est absent ou à la corbeille. */
export function applyAnalysis(
  lib: LibraryContext,
  itemId: number,
  a: AiAnalysis,
  meta: Pick<AiCallMeta, 'provider' | 'model'>,
  o: ApplyOptions,
): ItemRow | null {
  const { db, repos } = lib
  const fields = o.fields ?? AI_FIELDS
  return db.transaction((): ItemRow | null => {
    const item = repos.items.getById(itemId)
    if (!item || item.deleted_at !== null) return null
    const patch: Parameters<typeof repos.items.update>[1] = {
      aiState: 'done',
      aiProvider: meta.provider,
      aiModel: meta.model ?? null,
      aiLang: 'fr',
      aiUpdatedAt: o.now,
      updatedAt: o.now,
    }
    if (fields.includes('description') && a.description) patch.aiDescription = a.description
    if (fields.includes('ocr')) {
      if (a.ocr) patch.ocrText = a.ocr
      else if (o.force) patch.ocrText = null
    }
    if (fields.includes('title') && a.title) {
      patch.aiTitle = a.title
      if (shouldWriteTitle(item, o)) {
        patch.title = a.title
        patch.titleSource = 'ai'
      }
    }
    if (fields.includes('tags')) {
      const tags = filterTags(a.tags, o.vocabulary)
      db.prepare("DELETE FROM item_tags WHERE item_id = ? AND source = 'ai'").run(itemId)
      if (tags.length > 0) repos.tags.addToItems([itemId], tags, 'ai', o.now)
      patch.aiTags = tags
    }
    repos.items.update(itemId, patch)
    return repos.items.getById(itemId) ?? null
  })()
}

export function applyImagePrompt(
  lib: LibraryContext,
  itemId: number,
  v: { prompt: string; style: string },
  now: number,
): ItemRow | null {
  return lib.db.transaction((): ItemRow | null => {
    const item = lib.repos.items.getById(itemId)
    if (!item || item.deleted_at !== null) return null
    const text = v.style ? `${v.prompt}\n\nStyle : ${v.style}` : v.prompt
    lib.repos.items.update(itemId, { aiPrompt: text, aiUpdatedAt: now, updatedAt: now })
    return lib.repos.items.getById(itemId) ?? null
  })()
}
