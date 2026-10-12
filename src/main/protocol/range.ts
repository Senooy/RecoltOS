/**
 * `Range` header (RFC 9110 §14) for the `recolt://` protocol. A single byte range
 * is what Chromium's `<video>`/`<audio>` send. No `electron` import.
 */

export type RangeResult =
  /** No header: full 200 response. */
  | { kind: 'none' }
  /** Satisfiable range, bounds included: 206 response. */
  | { kind: 'partial'; start: number; end: number }
  /** Range outside the file, or unrecognized form: 416 response `Content-Range: bytes *\/size`. */
  | { kind: 'unsatisfiable' }

// Unit is case-insensitive (RFC 9110 §14.1).
const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/i

/**
 * `bytes=a-b`, `bytes=a-` and `bytes=-n` (suffix). End beyond the file: capped to `size - 1`.
 * `bytes=-0`, start ≥ size, start > end, multiple ranges or unknown unit: `unsatisfiable`
 * (we answer 416 rather than ignore a range we do not understand).
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
    // Suffix larger than the file: the whole representation (RFC 9110 §14.1.2).
    const suffix = Number(rawEnd)
    if (!(suffix > 0)) return { kind: 'unsatisfiable' }
    start = Math.max(0, size - suffix)
  } else {
    start = Number(rawStart)
    if (!Number.isFinite(start)) return { kind: 'unsatisfiable' }
    if (rawEnd !== '') {
      // End beyond the file (even absurdly large): capped to size - 1, as the RFC requires.
      const e = Number(rawEnd)
      end = Math.min(e, size - 1)
    }
  }
  if (start >= size || start > end) return { kind: 'unsatisfiable' }
  return { kind: 'partial', start, end }
}
