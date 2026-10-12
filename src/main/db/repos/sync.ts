/**
 * Sync repo: `sync_state` (one row per source),
 * `sync_items` ("already known" at publication level), `sync_dismissed` (never re-imported),
 * `sync_runs` (log). The sync logic lives in `src/main/sync/`.
 */
import type Database from 'better-sqlite3'
import { buildSet, repoBase, type ColumnSpec, type RepoOptions } from './util'

export type SyncSourceValue = 'x' | 'instagram' | 'cosmos'

export interface SyncStateRow {
  source: SyncSourceValue
  enabled: number
  allow_background_tab: number
  account_id: string | null
  account_handle: string | null
  status: string
  last_run_at: number | null
  last_success_at: number | null
  last_new_count: number
  last_error: string | null
  total_synced: number
  backfill_cursor: string | null
  backfill_done: number
  backfill_anchor_at: number | null
  backfill_pos: number
  last_deep_at: number | null
  cooldown_until: number | null
  consecutive_failures: number
  budget_day: string | null
  budget_used: number
}

export interface SyncStatePatch {
  enabled?: boolean
  allowBackgroundTab?: boolean
  accountId?: string | null
  accountHandle?: string | null
  status?: string
  lastRunAt?: number | null
  lastSuccessAt?: number | null
  lastNewCount?: number
  lastError?: string | null
  totalSynced?: number
  backfillCursor?: string | null
  backfillDone?: boolean
  backfillAnchorAt?: number | null
  backfillPos?: number
  lastDeepAt?: number | null
  cooldownUntil?: number | null
  consecutiveFailures?: number
  budgetDay?: string | null
  budgetUsed?: number
}

const STATE_COLUMNS: Readonly<Record<keyof SyncStatePatch, ColumnSpec>> = {
  enabled: { col: 'enabled', kind: 'bool' },
  allowBackgroundTab: { col: 'allow_background_tab', kind: 'bool' },
  accountId: { col: 'account_id' },
  accountHandle: { col: 'account_handle' },
  status: { col: 'status' },
  lastRunAt: { col: 'last_run_at' },
  lastSuccessAt: { col: 'last_success_at' },
  lastNewCount: { col: 'last_new_count' },
  lastError: { col: 'last_error' },
  totalSynced: { col: 'total_synced' },
  backfillCursor: { col: 'backfill_cursor' },
  backfillDone: { col: 'backfill_done', kind: 'bool' },
  backfillAnchorAt: { col: 'backfill_anchor_at' },
  backfillPos: { col: 'backfill_pos' },
  lastDeepAt: { col: 'last_deep_at' },
  cooldownUntil: { col: 'cooldown_until' },
  consecutiveFailures: { col: 'consecutive_failures' },
  budgetDay: { col: 'budget_day' },
  budgetUsed: { col: 'budget_used' },
}

/** `x:<id>` | `ig:<shortcode>` | `cosmos:<id>`. */
export function syncSourceKey(source: SyncSourceValue, externalId: string): string {
  return `${source === 'instagram' ? 'ig' : source}:${externalId}`
}

export function createSyncRepo(db: Database.Database, opts: RepoOptions = {}) {
  const { q, now } = repoBase(db, opts)

  const getState = (source: SyncSourceValue): SyncStateRow => {
    q('INSERT OR IGNORE INTO sync_state (source) VALUES (?)').run(source)
    return q('SELECT * FROM sync_state WHERE source = ?').get(source) as SyncStateRow
  }

  return {
    /** State of a source (row created with defaults if missing). */
    getState,

    patchState(source: SyncSourceValue, patch: SyncStatePatch): SyncStateRow {
      return db.transaction(() => {
        getState(source)
        const set = buildSet(patch, STATE_COLUMNS)
        if (set)
          q(`UPDATE sync_state SET ${set.sql} WHERE source = @source`).run({
            ...set.params,
            source,
          })
        return getState(source)
      })()
    },

    /** Marks a publication as known (and links it to its item). */
    upsertItem(
      i: {
        source: SyncSourceValue
        externalId: string
        itemId?: number | null
        accountId?: string | null
        remoteSort?: string | null
      },
      at: number = now(),
    ): void {
      q(
        `INSERT INTO sync_items (source_key, source, external_id, item_id, account_id,
           first_seen_at, last_seen_at, remote_sort)
         VALUES (@key, @source, @external_id, @item_id, @account_id, @at, @at, @remote_sort)
         ON CONFLICT (source_key) DO UPDATE SET
           item_id = coalesce(excluded.item_id, sync_items.item_id),
           account_id = coalesce(excluded.account_id, sync_items.account_id),
           remote_sort = coalesce(excluded.remote_sort, sync_items.remote_sort),
           last_seen_at = excluded.last_seen_at`,
      ).run({
        key: syncSourceKey(i.source, i.externalId),
        source: i.source,
        external_id: i.externalId,
        item_id: i.itemId ?? null,
        account_id: i.accountId ?? null,
        remote_sort: i.remoteSort ?? null,
        at,
      })
    },

    /** Subset of `externalIds` already known for this source. */
    knownExternalIds(source: SyncSourceValue, externalIds: readonly string[]): Set<string> {
      const rows = q(
        `SELECT external_id FROM sync_items WHERE source = ?
           AND external_id IN (SELECT value FROM json_each(?))`,
      ).all(source, JSON.stringify(externalIds)) as { external_id: string }[]
      return new Set(rows.map((r) => r.external_id))
    },

    dismiss(source: string, externalId: string, at: number = now()): boolean {
      return (
        q(
          'INSERT OR IGNORE INTO sync_dismissed (source, external_id, dismissed_at) VALUES (?, ?, ?)',
        ).run(source, externalId, at).changes > 0
      )
    },
    undismiss(source: string, externalId: string): boolean {
      return (
        q('DELETE FROM sync_dismissed WHERE source = ? AND external_id = ?').run(source, externalId)
          .changes > 0
      )
    },
    isDismissed(source: string, externalId: string): boolean {
      return (
        q('SELECT 1 FROM sync_dismissed WHERE source = ? AND external_id = ?').get(
          source,
          externalId,
        ) !== undefined
      )
    },

    startRun(r: {
      id: string
      source: SyncSourceValue
      mode: string
      reason: string
      browser?: string | null
      target?: string | null
      startedAt?: number
    }): void {
      q(
        `INSERT INTO sync_runs (id, source, mode, reason, browser, target, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        r.id,
        r.source,
        r.mode,
        r.reason,
        r.browser ?? null,
        r.target ?? null,
        r.startedAt ?? now(),
      )
    },
    finishRun(
      id: string,
      r: {
        status: string
        pages?: number
        newItems?: number
        knownItems?: number
        error?: string | null
      },
      at: number = now(),
    ): boolean {
      return (
        q(
          `UPDATE sync_runs SET finished_at = ?, status = ?, pages = ?, new_items = ?,
             known_items = ?, error = ? WHERE id = ?`,
        ).run(at, r.status, r.pages ?? 0, r.newItems ?? 0, r.knownItems ?? 0, r.error ?? null, id)
          .changes > 0
      )
    },
    listRuns(source: SyncSourceValue, limit = 20): Record<string, unknown>[] {
      return q('SELECT * FROM sync_runs WHERE source = ? ORDER BY started_at DESC LIMIT ?').all(
        source,
        limit,
      ) as Record<string, unknown>[]
    },
  }
}

export type SyncRepo = ReturnType<typeof createSyncRepo>
