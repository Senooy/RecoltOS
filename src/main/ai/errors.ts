/**
 * AI error classification. PRINCIPLE: only on error CHANNELS (claude
 * `system/api_retry`, rejected `rate_limit_event`, `result.is_error`; codex `type:"error"`,
 * `turn.failed`; exit code; spawn). Never on the agent's message (OCR, captions, a captured
 * « 429 Too Many Requests » page) nor on the prompt echo.
 */
import { AiError, type AiErrorCode } from '../../shared/ai-types'

export type ErrorSource = 'claude-result' | 'claude-retry' | 'codex-event' | 'exit' | 'spawn'

const RE_AUTH =
  /not logged in|please run \/login|authentication|oauth.*expired|invalid api key|\b401\b|unauthori[sz]ed/i
const RE_RATE =
  /usage limit|rate.?limit|limit reached|too many requests|\b429\b|overloaded|\b529\b|quota/i

const RETRY_RATE = new Set(['rate_limit', 'overloaded', 'billing_error'])
const RETRY_AUTH = new Set(['authentication_failed', 'oauth_org_not_allowed', 'account_on_hold'])

/** `limit reached|<epoch s>` → ms; otherwise `undefined`. */
export function parseResetAt(text: string): number | undefined {
  const m =
    /limit reached\|(\d{9,11})/i.exec(text) ?? /resets?At["']?\s*[:=]\s*(\d{9,11})/i.exec(text)
  return m ? Number(m[1]) * 1000 : undefined
}

export function classifyError(
  source: ErrorSource,
  text: string,
  extra?: { code?: string },
): AiError {
  const raw = text.slice(0, 300)
  if (source === 'spawn') {
    if (extra?.code === 'ENOENT' || extra?.code === 'EACCES')
      return new AiError('NOT_INSTALLED', 'CLI not found', { raw })
    return new AiError('PROCESS', 'launch failed', { raw, retryable: true })
  }
  if (source === 'exit') {
    return new AiError('PROCESS', 'the CLI stopped without a result', { raw, retryable: true })
  }
  if (source === 'claude-retry') {
    if (RETRY_AUTH.has(text)) return new AiError('NOT_AUTHENTICATED', 'not signed in', { raw })
    if (RETRY_RATE.has(text)) return new AiError('RATE_LIMITED', 'limite atteinte', { raw })
    // Other categories (server_error…): the CLI retries; we let the attempt run its course.
    return new AiError('PROCESS', `error ${text}`, { raw, retryable: true })
  }
  // claude-result / codex-event: CLI error message only.
  if (RE_AUTH.test(text)) return new AiError('NOT_AUTHENTICATED', 'not signed in', { raw })
  if (RE_RATE.test(text)) {
    const resetAt = parseResetAt(text)
    return new AiError('RATE_LIMITED', 'limite atteinte', { raw, ...(resetAt ? { resetAt } : {}) })
  }
  return new AiError('PROCESS', 'CLI error', { raw, retryable: true })
}

/** Final codes: never retried. */
export const FINAL_CODES: ReadonlySet<AiErrorCode> = new Set([
  'TOOL_VIOLATION',
  'FILE_MISSING',
  'DISABLED',
  'UNSUPPORTED_CLI',
])

export const AI_MAX_ATTEMPTS = 4

/** `min(30 s × 2^(n−1), 30 min) × (1 + rand·0.2)`. */
export function aiBackoffMs(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 30 * 60_000)
  return Math.round(base * (1 + rand() * 0.2))
}

/** Pause steps without `resetAt`: 15, then 30, then 60 min. */
export function ratePauseMs(consecutive: number): number {
  return [15, 30, 60][Math.min(Math.max(consecutive, 1), 3) - 1]! * 60_000
}

export function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code?: unknown }).code
    if (c === 'cancelled' || c === 'CANCELLED') return new AiError('CANCELLED', 'cancelled')
    if (c === 'not_found' || c === 'decode_failed' || c === 'system.decode_failed')
      return new AiError('FILE_MISSING', 'media unreadable or not found')
  }
  const msg = err instanceof Error ? err.message : String(err)
  return new AiError('PROCESS', msg.slice(0, 300), { retryable: true })
}
