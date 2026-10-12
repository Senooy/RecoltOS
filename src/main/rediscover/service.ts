/**
 * Rediscover service: paginated deck (full order memorized per seed and scope), actions
 * logged in `rediscover_log`, undo ≤ 10 s (stack of 10). Without Electron: the
 * dependencies (database, repos, emission) are injected.
 */
import type Database from 'better-sqlite3'
import { AppError } from '../../shared/errors'
import type { Repos } from '../db/repos'
import { drawOrder, loadCandidates, recentCollections } from './select'
import { mt } from '../i18n'

export type RediscoverAction = 'keep' | 'trash' | 'collection' | 'skip'

export const UNDO_WINDOW_MS = 10_000
const UNDO_DEPTH = 10

export interface RediscoverDeps {
  db: Database.Database
  repos: Repos
  now?: () => number
  changed?: (uuids: string[], reason: 'updated' | 'trashed' | 'restored') => void
  collectionsChanged?: (uuids: string[]) => void
}

interface Done {
  at: number
  logId: number
  itemId: number
  itemUuid: string
  action: RediscoverAction
  prevViewCount?: number
  prevViewedAt?: number | null
  collection?: { id: number; uuid: string; added: boolean }
}

export function createRediscover() {
  let deckKey = ''
  let order: number[] = []
  const done: Done[] = []

  const sessionIdOf = (seed: number, scope: string) => `rd-${seed}-${scope}`

  return {
    deck(
      deps: RediscoverDeps,
      input: { seed: number; limit: number; offset: number; collectionUuid?: string | undefined },
    ) {
      const { db, repos } = deps
      const now = (deps.now ?? Date.now)()
      let cid: number | null = null
      if (input.collectionUuid) {
        const id = repos.collections.idByUuid(input.collectionUuid)
        if (id === undefined) throw new AppError('not_found', mt().errors.collectionNotFound)
        cid = id
      }
      const key = `${input.seed}:${cid ?? 'lib'}`
      if (key !== deckKey || input.offset === 0) {
        order = drawOrder(loadCandidates(db, cid), input.seed, now)
        deckKey = key
      }
      return {
        sessionId: sessionIdOf(input.seed, String(cid ?? 'lib')),
        total: order.length,
        ids: order.slice(input.offset, input.offset + input.limit),
        suggestedCollections: recentCollections(db, 3),
      }
    },

    act(
      deps: RediscoverDeps,
      input: {
        itemUuid: string
        action: RediscoverAction
        collectionUuid?: string | undefined
        sessionId?: string | undefined
      },
    ): void {
      const { db, repos } = deps
      const now = (deps.now ?? Date.now)()
      const item = repos.items.getByUuid(input.itemUuid)
      if (!item) throw new AppError('not_found', mt().errors.itemNotFound)
      const entry: Done = {
        at: now,
        logId: 0,
        itemId: item.id,
        itemUuid: item.uuid,
        action: input.action,
      }
      let collectionId: number | null = null
      db.transaction(() => {
        if (input.action === 'keep') {
          entry.prevViewCount = item.view_count
          entry.prevViewedAt = item.viewed_at
          repos.items.markViewed(item.id, now)
        } else if (input.action === 'trash') {
          repos.items.trash([item.id], now)
        } else if (input.action === 'collection') {
          if (!input.collectionUuid) throw new AppError('validation', mt().errors.chooseCollection)
          const id = repos.collections.idByUuid(input.collectionUuid)
          if (id === undefined) throw new AppError('not_found', mt().errors.collectionNotFound)
          collectionId = id
          const already = db
            .prepare('SELECT 1 FROM collection_items WHERE collection_id = ? AND item_id = ?')
            .get(id, item.id)
          if (!already) repos.collections.addItems(id, [item.id], now)
          entry.collection = { id, uuid: input.collectionUuid, added: !already }
        }
        entry.logId = Number(
          db
            .prepare(
              `INSERT INTO rediscover_log(item_id, session_id, shown_at, action, collection_id)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .run(item.id, input.sessionId ?? 'rd', now, input.action, collectionId).lastInsertRowid,
        )
      })()
      done.push(entry)
      if (done.length > UNDO_DEPTH) done.shift()
      if (input.action === 'trash') deps.changed?.([item.uuid], 'trashed')
      else if (input.action !== 'skip') deps.changed?.([item.uuid], 'updated')
      if (entry.collection) deps.collectionsChanged?.([entry.collection.uuid])
    },

    /** Undoes the last action made less than 10 s ago; `null` otherwise. */
    undo(deps: RediscoverDeps): { itemUuid: string } | null {
      const { db, repos } = deps
      const now = (deps.now ?? Date.now)()
      const last = done.at(-1)
      if (!last || now - last.at > UNDO_WINDOW_MS) return null
      done.pop()
      db.transaction(() => {
        if (last.action === 'keep') {
          db.prepare('UPDATE items SET view_count = ?, viewed_at = ? WHERE id = ?').run(
            last.prevViewCount ?? 0,
            last.prevViewedAt ?? null,
            last.itemId,
          )
        } else if (last.action === 'trash') {
          repos.items.restore([last.itemId], now)
        } else if (last.action === 'collection' && last.collection?.added) {
          repos.collections.removeItems(last.collection.id, [last.itemId])
        }
        db.prepare('DELETE FROM rediscover_log WHERE id = ?').run(last.logId)
      })()
      deps.changed?.([last.itemUuid], last.action === 'trash' ? 'restored' : 'updated')
      if (last.collection?.added) deps.collectionsChanged?.([last.collection.uuid])
      return { itemUuid: last.itemUuid }
    },
  }
}

export const rediscover = createRediscover()
