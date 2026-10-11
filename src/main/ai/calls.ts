/**
 * Journal des envois `ai_calls` (AI §6.1, §11) : base du budget et de « Journal des envois ».
 * Rétention 90 jours. Aucun contenu n'y est écrit : fichiers (nom, octets, dimensions), nombre de
 * caractères, empreinte du prompt, résultat.
 */
import type Database from 'better-sqlite3'
import type { AiCallMeta, AiErrorCode } from '../../shared/ai-types'
import type { AiCallEntry } from '../../shared/dto/ai'

export const CALLS_RETENTION_MS = 90 * 86_400_000

export type CallOutcome = AiCallEntry['outcome']

export function outcomeOf(code: AiErrorCode | null): CallOutcome {
  switch (code) {
    case null:
      return 'ok'
    case 'RATE_LIMITED':
      return 'rate_limited'
    case 'TIMEOUT':
      return 'timeout'
    case 'TOOL_VIOLATION':
      return 'violation'
    case 'CANCELLED':
      return 'cancelled'
    default:
      return 'error'
  }
}

export interface LogCallInput {
  ts: number
  jobId: number | null
  itemId: number | null
  priority: number | null
  provider: 'claude' | 'codex'
  model: string | null
  task: string
  meta: Pick<AiCallMeta, 'sentFiles' | 'sentTextChars' | 'promptSha256'> &
    Partial<Pick<AiCallMeta, 'durationMs' | 'inputTokens' | 'outputTokens' | 'costUsd'>>
  outcome: CallOutcome
  errorCode: string | null
}

export function logCall(db: Database.Database, c: LogCallInput): number {
  const usage =
    c.meta.inputTokens !== undefined ||
    c.meta.outputTokens !== undefined ||
    c.meta.costUsd !== undefined
      ? JSON.stringify({
          inputTokens: c.meta.inputTokens ?? null,
          outputTokens: c.meta.outputTokens ?? null,
          costUsd: c.meta.costUsd ?? null,
        })
      : null
  return Number(
    db
      .prepare(
        `INSERT INTO ai_calls (ts, job_id, item_id, priority, provider, model, task, sent_files,
           sent_text_chars, prompt_sha256, duration_ms, outcome, error_code, usage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.ts,
        c.jobId,
        c.itemId,
        c.priority,
        c.provider,
        c.model,
        c.task,
        JSON.stringify(c.meta.sentFiles),
        c.meta.sentTextChars,
        c.meta.promptSha256,
        c.meta.durationMs ?? null,
        c.outcome,
        c.errorCode,
        usage,
      ).lastInsertRowid,
  )
}

export function listCalls(db: Database.Database, limit: number): AiCallEntry[] {
  const rows = db
    .prepare(
      `SELECT c.*, i.uuid AS item_uuid FROM ai_calls c LEFT JOIN items i ON i.id = c.item_id
       ORDER BY c.ts DESC, c.id DESC LIMIT ?`,
    )
    .all(limit) as {
    id: number
    ts: number
    item_uuid: string | null
    provider: 'claude' | 'codex'
    model: string | null
    task: string
    sent_files: string
    sent_text_chars: number
    duration_ms: number | null
    outcome: CallOutcome
    error_code: string | null
  }[]
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    itemUuid: r.item_uuid,
    provider: r.provider,
    model: r.model,
    task: r.task,
    sentFiles: JSON.parse(r.sent_files) as AiCallEntry['sentFiles'],
    sentTextChars: r.sent_text_chars,
    durationMs: r.duration_ms,
    outcome: r.outcome,
    errorCode: r.error_code,
  }))
}

export function clearCalls(db: Database.Database): number {
  return db.prepare('DELETE FROM ai_calls').run().changes
}

export function purgeOldCalls(db: Database.Database, now: number): number {
  return db.prepare('DELETE FROM ai_calls WHERE ts < ?').run(now - CALLS_RETENTION_MS).changes
}

/** Durée moyenne glissante (20 derniers appels réussis), pour l'ETA des lots. */
export function averageDurationMs(db: Database.Database, fallbackMs = 18_000): number {
  const r = db
    .prepare(
      `SELECT avg(duration_ms) AS a FROM (SELECT duration_ms FROM ai_calls
       WHERE outcome = 'ok' AND duration_ms IS NOT NULL ORDER BY ts DESC LIMIT 20)`,
    )
    .get() as { a: number | null }
  return r.a ?? fallbackMs
}
