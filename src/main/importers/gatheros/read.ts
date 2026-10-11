/**
 * Lecture tolérante de la copie de `moodmark.db` (ARCHI §6.3 phase `read`) : `z.looseObject`,
 * colonnes absentes = `null`. Aucune écriture : la copie est ouverte en lecture seule.
 */
import Database from 'better-sqlite3'
import { z } from 'zod'

const str = z.string().nullable().catch(null)
const int = z.number().nullable().catch(null)

export const SaveRow = z.looseObject({
  id: z.string(),
  file_path: z.string().catch(''),
  thumb_path: str.default(null),
  title: str.default(null),
  source_url: str.default(null),
  width: int.default(null),
  height: int.default(null),
  file_size: int.default(null),
  palette: str.default(null),
  palette_lab: str.default(null),
  created_at: z.number(),
  ai_description: str.default(null),
  ocr_text: str.default(null),
  ai_prompt: str.default(null),
  deleted_at: int.default(null),
  hidden_at: int.default(null),
  notes: str.default(null),
  content_hash: str.default(null),
  kind: z.string().catch('image').default('image'),
  tweet_meta: str.default(null),
  source: z.string().catch('x').default('x'),
  view_count: z.number().catch(0).default(0),
  viewed_at: int.default(null),
})
export type SaveRow = z.output<typeof SaveRow>

export const CollectionRowG = z.looseObject({
  id: z.string(),
  name: z.string().catch(''),
  color: z.string().catch('#007aff'),
  created_at: z.number(),
  order_index: z.number().catch(0).default(0),
  parent_id: str.default(null),
  cover_save_id: str.default(null),
})
export type CollectionRowG = z.output<typeof CollectionRowG>

export interface GatherosData {
  userVersion: number
  saves: SaveRow[]
  collections: CollectionRowG[]
  collectionItems: { collection_id: string; save_id: string; added_at: number }[]
  /** `save_id` → noms de tags. */
  tagsBySave: Map<string, string[]>
  tagNames: string[]
  dismissed: { tweet_key: string; dismissed_at: number }[]
  warnings: string[]
}

function hasTable(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name),
  )
}

export function readGatheros(dbPath: string): GatherosData {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const warnings: string[] = []
    const userVersion = Number(db.pragma('user_version', { simple: true }))
    if (userVersion !== 17) warnings.push(`schéma GatherOS v${userVersion} (validé : v17)`)
    const saves: SaveRow[] = []
    for (const raw of db.prepare('SELECT * FROM saves ORDER BY created_at, id').all()) {
      const r = SaveRow.safeParse(raw)
      if (r.success) saves.push(r.data)
      else warnings.push(`élément illisible ignoré : ${String((raw as { id?: unknown }).id)}`)
    }
    const collections = hasTable(db, 'collections')
      ? db
          .prepare('SELECT * FROM collections')
          .all()
          .flatMap((raw) => {
            const r = CollectionRowG.safeParse(raw)
            return r.success ? [r.data] : []
          })
      : []
    const collectionItems = hasTable(db, 'collection_items')
      ? (db
          .prepare(
            'SELECT collection_id, save_id, added_at FROM collection_items ORDER BY added_at',
          )
          .all() as GatherosData['collectionItems'])
      : []
    const tagsBySave = new Map<string, string[]>()
    let tagNames: string[] = []
    if (hasTable(db, 'tags') && hasTable(db, 'save_tags')) {
      for (const r of db
        .prepare('SELECT st.save_id, t.name FROM save_tags st JOIN tags t ON t.id = st.tag_id')
        .all() as { save_id: string; name: string }[]) {
        const list = tagsBySave.get(r.save_id) ?? []
        list.push(r.name)
        tagsBySave.set(r.save_id, list)
      }
      tagNames = (db.prepare('SELECT name FROM tags').all() as { name: string }[]).map(
        (r) => r.name,
      )
    }
    const dismissed = hasTable(db, 'dismissed_tweets')
      ? (db
          .prepare('SELECT tweet_key, dismissed_at FROM dismissed_tweets')
          .all() as GatherosData['dismissed'])
      : []
    return {
      userVersion,
      saves,
      collections,
      collectionItems,
      tagsBySave,
      tagNames,
      dismissed,
      warnings,
    }
  } finally {
    db.close()
  }
}
