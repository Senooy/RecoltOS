/**
 * Erreurs applicatives transportées par l'IPC sous la forme `{ code, message }` (ARCHI §2.3).
 * Pas de propriétés de paramètre (`erasableSyntaxOnly`).
 */

export const APP_ERROR_CODES = [
  'not_implemented',
  'validation',
  'unknown_channel',
  'forbidden_sender',
  'invalid_output',
  'internal',
  'not_found',
  'conflict',
  'busy',
  'io',
  'cancelled',
  'timeout',
  'tag_reserved',
  'collection_cycle',
  'wal_not_empty',
  'tool_missing',
  'library_unavailable',
  'synced_folder_refused',
  'permission_required',
  'limit_exceeded',
] as const
export type KnownAppErrorCode = (typeof APP_ERROR_CODES)[number]
/** Les lots peuvent introduire des codes propres à leur domaine (préfixés), d'où `string`. */
export type AppErrorCode = KnownAppErrorCode | (string & {})

/**
 * Message lisible d'une liste d'anomalies zod, en français (règle §2.6). Remplace
 * `z.prettifyError`, qui insère « at » et des libellés anglais dans les toasts.
 */
export function formatIssues(
  issues: readonly { message: string; path: readonly PropertyKey[] }[],
): string {
  if (issues.length === 0) return 'Entrée invalide'
  return issues
    .map((i) => {
      const where = i.path.length > 0 ? ` (champ ${i.path.map(String).join('.')})` : ''
      return `${i.message}${where}`
    })
    .join(' ; ')
}

export interface AppErrorShape {
  code: AppErrorCode
  message: string
  details?: unknown
}

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly details: unknown

  constructor(code: AppErrorCode, message?: string, details?: unknown) {
    super(message ?? code)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }

  toJSON(): AppErrorShape {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details }
  }
}

export function isAppErrorShape(v: unknown): v is AppErrorShape {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { code?: unknown }).code === 'string' &&
    typeof (v as { message?: unknown }).message === 'string'
  )
}

/** Enveloppe de réponse du canal `rpc` (le routeur ne lève jamais vers le renderer). */
export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorShape }
