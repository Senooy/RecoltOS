/**
 * `jobs` repo: SQL primitives of the single queue (`priority DESC`).
 * Scheduling (per-type loops, concurrency, pauses, handlers) belongs to
 * (`jobs/queue.ts`).
 */
import type Database from 'better-sqlite3'
import {
  JOB_PRIORITY,
  JobPayloadBase,
  type JobError,
  type JobRecord,
  type JobState,
  type JobType,
} from '../../../shared/jobs'
import { repoBase, type RepoOptions } from './util'

export interface JobRow {
  id: number
  type: JobType
  item_id: number | null
  dedupe_key: string | null
  payload: string
  state: JobState
  priority: number
  attempts: number
  max_attempts: number
  last_error: string | null
  run_after: number
  batch_id: number | null
  provider: string | null
  created_at: number
  updated_at: number
}

export interface EnqueueInput {
  type: JobType
  itemId?: number | null
  dedupeKey?: string | null
  payload?: Record<string, unknown>
  priority?: number
  runAfter?: number
  maxAttempts?: number
  batchId?: number | null
}

export function toJobRecord(row: JobRow): JobRecord {
  let raw: unknown = {}
  try {
    raw = JSON.parse(row.payload)
  } catch {
    raw = {}
  }
  const parsed = JobPayloadBase.safeParse(raw)
  return {
    id: row.id,
    type: row.type,
    itemId: row.item_id,
    dedupeKey: row.dedupe_key,
    payload: parsed.success ? parsed.data : { failedOn: [] },
    state: row.state,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    batchId: row.batch_id,
    provider: row.provider,
  }
}

/**
 * Notified after each `enqueue` / `requeueFailed` (the queue wakes up on demand instead of
 * polling). Set by `jobs/queue.ts`; never throws.
 */
let onJobsAdded: (() => void) | null = null
export function setJobsAddedListener(fn: (() => void) | null): void {
  onJobsAdded = fn
}
const notifyAdded = (): void => {
  try {
    onJobsAdded?.()
  } catch {
    // the queue is stopping: nothing to wake
  }
}

export function createJobsRepo(db: Database.Database, opts: RepoOptions = {}) {
  const { q, now } = repoBase(db, opts)
  const requeueTx = db.transaction((type: JobType | null, at: number): number => {
    // `ux_jobs_active` forbids two active jobs with the same (type, dedupe_key): the `failed`
    // superseded ones (key already active, or a more recent `failed` with the same key) become `cancelled`.
    q(
      `UPDATE jobs SET state = 'cancelled', updated_at = @at
       WHERE state = 'failed' AND (@type IS NULL OR type = @type) AND dedupe_key IS NOT NULL AND (
         EXISTS (SELECT 1 FROM jobs a WHERE a.type = jobs.type AND a.dedupe_key = jobs.dedupe_key
                   AND a.state IN ('queued','running'))
         OR EXISTS (SELECT 1 FROM jobs f WHERE f.type = jobs.type AND f.dedupe_key = jobs.dedupe_key
                      AND f.state = 'failed' AND f.id > jobs.id))`,
    ).run({ type, at })
    return q(
      `UPDATE jobs SET state = 'queued', attempts = 0, run_after = 0, updated_at = @at
       WHERE state = 'failed' AND (@type IS NULL OR type = @type)`,
    ).run({ type, at }).changes
  })
  return {
    /**
     * Adds a job. With `dedupeKey`, an active job (`queued`/`running`) of the same type is reused
     * and its priority raised if needed (`ux_jobs_active`). Returns the id.
     */
    enqueue(j: EnqueueInput, at: number = now()): number {
      const row = q(
        `INSERT INTO jobs (type, item_id, dedupe_key, payload, priority, run_after, max_attempts,
           batch_id, created_at, updated_at)
         VALUES (@type, @item_id, @dedupe_key, @payload, @priority, @run_after, @max_attempts,
           @batch_id, @at, @at)
         ON CONFLICT (type, dedupe_key) WHERE state IN ('queued','running') AND dedupe_key IS NOT NULL
         DO UPDATE SET priority = max(jobs.priority, excluded.priority), updated_at = excluded.updated_at
         RETURNING id`,
      ).get({
        type: j.type,
        item_id: j.itemId ?? null,
        dedupe_key: j.dedupeKey ?? null,
        payload: JSON.stringify({ failedOn: [], ...(j.payload ?? {}) }),
        priority: j.priority ?? JOB_PRIORITY.BACKGROUND,
        run_after: j.runAfter ?? 0,
        max_attempts: j.maxAttempts ?? 3,
        batch_id: j.batchId ?? null,
        at,
      }) as { id: number }
      notifyAdded()
      return row.id
    },

    /** Earliest `run_after` of a queued job still in the future (`null`: none): next wake-up. */
    nextRunAfter(at: number = now()): number | null {
      const row = q(
        "SELECT min(run_after) AS t FROM jobs WHERE state = 'queued' AND run_after > ?",
      ).get(at) as { t: number | null }
      return row.t
    },

    /** Takes the next ready job of a type and sets it to `running`. */
    claimNext(type: JobType, at: number = now()): JobRecord | null {
      const row = q(
        `UPDATE jobs SET state = 'running', attempts = attempts + 1, updated_at = @now
         WHERE id = (SELECT id FROM jobs
                     WHERE type = @type AND state = 'queued' AND run_after <= @now
                     ORDER BY priority DESC, run_after, id LIMIT 1)
         RETURNING *`,
      ).get({ type, now: at }) as JobRow | undefined
      return row ? toJobRecord(row) : null
    },

    complete(id: number, at: number = now()): boolean {
      return (
        q("UPDATE jobs SET state = 'done', last_error = NULL, updated_at = ? WHERE id = ?").run(
          at,
          id,
        ).changes > 0
      )
    },

    /** New attempt at `retryAt`; `refundAttempt` = without consuming an attempt (AI limit). */
    retry(
      id: number,
      retryAt: number,
      error: JobError | null,
      options: { refundAttempt?: boolean; at?: number } = {},
    ): boolean {
      return (
        q(
          `UPDATE jobs SET state = 'queued', run_after = @retry_at, last_error = @error,
             attempts = CASE WHEN @refund = 1 THEN max(0, attempts - 1) ELSE attempts END,
             updated_at = @at WHERE id = @id`,
        ).run({
          id,
          retry_at: retryAt,
          error: error ? JSON.stringify(error) : null,
          refund: options.refundAttempt ? 1 : 0,
          at: options.at ?? now(),
        }).changes > 0
      )
    },

    fail(id: number, error: JobError, at: number = now()): boolean {
      return (
        q("UPDATE jobs SET state = 'failed', last_error = ?, updated_at = ? WHERE id = ?").run(
          JSON.stringify(error),
          at,
          id,
        ).changes > 0
      )
    },

    /** Cancels the active jobs of an item (or of a type for that item). */
    cancelForItem(itemId: number, type?: JobType, at: number = now()): number {
      return q(
        `UPDATE jobs SET state = 'cancelled', updated_at = @at
         WHERE item_id = @item AND state IN ('queued','running') AND (@type IS NULL OR type = @type)`,
      ).run({ item: itemId, type: type ?? null, at }).changes
    },

    /**
     * Puts `failed` jobs back to `queued` (the "Réessayer" button). Duplicate dedupe keys
     * already active or superseded are cancelled instead of being re-run.
     */
    requeueFailed(type?: JobType, at: number = now()): number {
      const n = requeueTx(type ?? null, at)
      if (n > 0) notifyAdded()
      return n
    },

    /** At startup: jobs left `running` go back to `queued`. */
    resetRunning(at: number = now()): number {
      return q("UPDATE jobs SET state = 'queued', updated_at = ? WHERE state = 'running'").run(at)
        .changes
    },

    /** Cleanup: `done` / `cancelled` jobs older than `before`. */
    cleanup(before: number): number {
      return q("DELETE FROM jobs WHERE state IN ('done','cancelled') AND updated_at < ?").run(
        before,
      ).changes
    },

    get(id: number): JobRecord | null {
      const row = q('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined
      return row ? toJobRecord(row) : null
    },
    getRow(id: number): JobRow | undefined {
      return q('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined
    },

    /** Counters per type and state (`jobs.progress`). */
    countsByType(): Record<string, { queued: number; running: number; failed: number }> {
      const rows = q(
        `SELECT type,
           sum(state = 'queued') AS queued, sum(state = 'running') AS running,
           sum(state = 'failed') AS failed
         FROM jobs GROUP BY type`,
      ).all() as { type: string; queued: number; running: number; failed: number }[]
      return Object.fromEntries(
        rows.map((r) => [r.type, { queued: r.queued, running: r.running, failed: r.failed }]),
      )
    },
  }
}

export type JobsRepo = ReturnType<typeof createJobsRepo>
