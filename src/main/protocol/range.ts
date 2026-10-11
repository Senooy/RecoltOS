/**
 * En-tête `Range` (RFC 9110 §14) pour le protocole `recolt://` (ARCHI §2.5). Une seule plage
 * d'octets : c'est ce qu'envoient `<video>`/`<audio>` de Chromium. Pas d'import `electron`.
 */

export type RangeResult =
  /** Pas d'en-tête : réponse 200 complète. */
  | { kind: 'none' }
  /** Plage satisfaisable, bornes incluses : réponse 206. */
  | { kind: 'partial'; start: number; end: number }
  /** Plage hors du fichier, ou forme non comprise : réponse 416 `Content-Range: bytes *\/size`. */
  | { kind: 'unsatisfiable' }

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/

/**
 * `bytes=a-b`, `bytes=a-` et `bytes=-n` (suffixe). Fin au-delà du fichier : ramenée à `size - 1`.
 * `bytes=-0`, début ≥ taille, début > fin, plages multiples ou unité inconnue : `unsatisfiable`
 * (ARCHI §2.5 : on répond 416 plutôt que d'ignorer une plage incomprise).
 */
export function parseRange(header: string | null | undefined, size: number): RangeResult {
  if (header === null || header === undefined) return { kind: 'none' }
  const m = SINGLE_RANGE.exec(header.trim())
  if (!m) return { kind: 'unsatisfiable' }
  const [, rawStart = '', rawEnd = ''] = m
  if (rawStart === '' && rawEnd === '') return { kind: 'unsatisfiable' }
  if (size <= 0) return { kind: 'unsatisfiable' }

  let start: number
  let end = size - 1
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: 'unsatisfiable' }
    start = Math.max(0, size - suffix)
  } else {
    start = Number(rawStart)
    if (!Number.isSafeInteger(start)) return { kind: 'unsatisfiable' }
    if (rawEnd !== '') {
      const e = Number(rawEnd)
      if (!Number.isSafeInteger(e)) return { kind: 'unsatisfiable' }
      end = Math.min(e, size - 1)
    }
  }
  if (start >= size || start > end) return { kind: 'unsatisfiable' }
  return { kind: 'partial', start, end }
}
