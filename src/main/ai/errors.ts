/**
 * Classification des erreurs IA (AI §6.5). PRINCIPE : uniquement sur les CANAUX d'erreur (claude
 * `system/api_retry`, `rate_limit_event` refusé, `result.is_error` ; codex `type:"error"`,
 * `turn.failed` ; code de sortie ; spawn). Jamais sur le message de l'agent (OCR, légendes, page
 * « 429 Too Many Requests » capturée) ni sur l'écho du prompt.
 */
import { AiError, type AiErrorCode } from '../../shared/ai-types'

export type ErrorSource = 'claude-result' | 'claude-retry' | 'codex-event' | 'exit' | 'spawn'

const RE_AUTH =
  /not logged in|please run \/login|authentication|oauth.*expired|invalid api key|\b401\b|unauthori[sz]ed/i
const RE_RATE =
  /usage limit|rate.?limit|limit reached|too many requests|\b429\b|overloaded|\b529\b|quota/i

const RETRY_RATE = new Set(['rate_limit', 'overloaded', 'billing_error'])
const RETRY_AUTH = new Set(['authentication_failed', 'oauth_org_not_allowed', 'account_on_hold'])

/** `limit reached|<epoch s>` → ms ; sinon `undefined`. */
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
      return new AiError('NOT_INSTALLED', 'CLI introuvable', { raw })
    return new AiError('PROCESS', 'lancement impossible', { raw, retryable: true })
  }
  if (source === 'exit') {
    return new AiError('PROCESS', 'le CLI s’est arrêté sans résultat', { raw, retryable: true })
  }
  if (source === 'claude-retry') {
    if (RETRY_AUTH.has(text)) return new AiError('NOT_AUTHENTICATED', 'non connecté', { raw })
    if (RETRY_RATE.has(text)) return new AiError('RATE_LIMITED', 'limite atteinte', { raw })
    // Autres catégories (server_error…) : le CLI réessaie ; on laisse la tentative suivre son cours.
    return new AiError('PROCESS', `erreur ${text}`, { raw, retryable: true })
  }
  // claude-result / codex-event : message d'erreur du CLI uniquement.
  if (RE_AUTH.test(text)) return new AiError('NOT_AUTHENTICATED', 'non connecté', { raw })
  if (RE_RATE.test(text)) {
    const resetAt = parseResetAt(text)
    return new AiError('RATE_LIMITED', 'limite atteinte', { raw, ...(resetAt ? { resetAt } : {}) })
  }
  return new AiError('PROCESS', 'erreur du CLI', { raw, retryable: true })
}

/** Codes définitifs : jamais réessayés. */
export const FINAL_CODES: ReadonlySet<AiErrorCode> = new Set([
  'TOOL_VIOLATION',
  'FILE_MISSING',
  'DISABLED',
  'UNSUPPORTED_CLI',
])

export const AI_MAX_ATTEMPTS = 4

/** `min(30 s × 2^(n−1), 30 min) × (1 + rand·0,2)` (AI §6.5). */
export function aiBackoffMs(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 30 * 60_000)
  return Math.round(base * (1 + rand() * 0.2))
}

/** Paliers de pause sans `resetAt` : 15, 30 puis 60 min. */
export function ratePauseMs(consecutive: number): number {
  return [15, 30, 60][Math.min(Math.max(consecutive, 1), 3) - 1]! * 60_000
}

export function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code?: unknown }).code
    if (c === 'cancelled' || c === 'CANCELLED') return new AiError('CANCELLED', 'annulé')
    if (c === 'not_found' || c === 'decode_failed' || c === 'system.decode_failed')
      return new AiError('FILE_MISSING', 'média illisible ou introuvable')
  }
  const msg = err instanceof Error ? err.message : String(err)
  return new AiError('PROCESS', msg.slice(0, 300), { retryable: true })
}
