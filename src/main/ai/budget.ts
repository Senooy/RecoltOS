/**
 * Budget protecting the subscription, priorities `priority DESC`:
 * MANUAL (100) ≈ "0", INTERACTIVE (80) ≈ "10" (single capture), SYNC (60) ≈ "15",
 * BATCH (20) ≈ "20".
 * - hard cap `hardPerDay` (rolling 24 h, per provider): ALL priorities, except
 *   override `ai.budgetOverrideUntil`;
 * - MANUAL: exempt from perHour, perDay and minGap;
 * - INTERACTIVE: exempt from perHour / perDay; beyond 5 calls ≥ INTERACTIVE per minute, the job
 *   is downgraded to SYNC;
 * - SYNC and BATCH: perHour (rolling window 3,600,000 ms), perDay, minGap.
 * Counted: `ok`, `error`, `rate_limited`, `timeout`, `violation` (`cancelled` excluded).
 */
import type Database from 'better-sqlite3'
import { JOB_PRIORITY } from '../../shared/jobs'
import type { AiPrefs } from '../../shared/prefs'

export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000
export const BURST_PER_MIN = 5
export const OVERRIDE_SETTING = 'ai.budgetOverrideUntil'

export type BudgetReason = 'perHour' | 'perDay' | 'hardCap' | 'gap' | 'burst'
export interface BudgetDecision {
  ok: boolean
  waitMs?: number
  reason?: BudgetReason
  demoteTo?: number
}

const COUNTED = `outcome IN ('ok','error','rate_limited','timeout','violation')`

function count(db: Database.Database, provider: string, since: number, minPriority?: number) {
  return db
    .prepare(
      `SELECT count(*) AS n, min(ts) AS first FROM ai_calls
         WHERE provider = ? AND ts > ? AND ${COUNTED} AND (? IS NULL OR priority >= ?)`,
    )
    .get(provider, since, minPriority ?? null, minPriority ?? null) as {
    n: number
    first: number | null
  }
}

/** Timestamp of the `k`-th most recent call in the window (to compute the wait). */
function nthRecent(db: Database.Database, provider: string, since: number, k: number) {
  const r = db
    .prepare(
      `SELECT ts FROM ai_calls WHERE provider = ? AND ts > ? AND ${COUNTED}
       ORDER BY ts DESC LIMIT 1 OFFSET ?`,
    )
    .get(provider, since, Math.max(0, k - 1)) as { ts: number } | undefined
  return r?.ts ?? null
}

export function usage(db: Database.Database, provider: string, now: number) {
  return {
    hour: count(db, provider, now - HOUR_MS).n,
    day: count(db, provider, now - DAY_MS).n,
  }
}

export function canStart(
  db: Database.Database,
  provider: string,
  priority: number,
  prefs: Pick<AiPrefs, 'perHour' | 'perDay' | 'hardPerDay' | 'minGapMs'>,
  now: number,
  overrideUntil = 0,
): BudgetDecision {
  const day = count(db, provider, now - DAY_MS)
  if (day.n >= prefs.hardPerDay && !(overrideUntil > now)) {
    const t = nthRecent(db, provider, now - DAY_MS, prefs.hardPerDay)
    return { ok: false, reason: 'hardCap', waitMs: t ? Math.max(1_000, t + DAY_MS - now) : DAY_MS }
  }
  if (priority >= JOB_PRIORITY.MANUAL) return { ok: true }
  if (priority >= JOB_PRIORITY.INTERACTIVE) {
    const burst = count(db, provider, now - 60_000, JOB_PRIORITY.INTERACTIVE)
    if (burst.n >= BURST_PER_MIN) return { ok: false, reason: 'burst', demoteTo: JOB_PRIORITY.SYNC }
    return { ok: true }
  }
  if (day.n >= prefs.perDay) {
    const t = nthRecent(db, provider, now - DAY_MS, prefs.perDay)
    return { ok: false, reason: 'perDay', waitMs: t ? Math.max(1_000, t + DAY_MS - now) : HOUR_MS }
  }
  const hour = count(db, provider, now - HOUR_MS)
  if (hour.n >= prefs.perHour) {
    const t = nthRecent(db, provider, now - HOUR_MS, prefs.perHour)
    return { ok: false, reason: 'perHour', waitMs: t ? Math.max(1_000, t + HOUR_MS - now) : 60_000 }
  }
  const last = nthRecent(db, provider, now - DAY_MS, 1)
  if (last !== null && now - last < prefs.minGapMs)
    return { ok: false, reason: 'gap', waitMs: prefs.minGapMs - (now - last) }
  return { ok: true }
}
