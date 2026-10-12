/**
 * French plural: 0 and 1 take the singular
 * (« 0 élément », « 1 élément », « 2 éléments »).
 */
export function isPlural(n: number): boolean {
  return Math.abs(n) >= 2
}

export function plural(n: number, one: string, many: string): string {
  return isPlural(n) ? many : one
}

/**
 * « 3 éléments »; the thin non-breaking space (U+202F) for thousands is handled by
 * `lib/format.ts`.
 */
export function count(
  n: number,
  one: string,
  many: string,
  format: (n: number) => string = String,
): string {
  return `${format(n)} ${plural(n, one, many)}`
}

/** English plural: only 1 takes the singular (« 0 items », « 1 item », « 2 items »). */
export function isPluralEn(n: number): boolean {
  return Math.abs(n) !== 1
}

export function pluralEn(n: number, one: string, many: string): string {
  return isPluralEn(n) ? many : one
}

/** « 3 items » (English). */
export function countEn(
  n: number,
  one: string,
  many: string,
  format: (n: number) => string = String,
): string {
  return `${format(n)} ${pluralEn(n, one, many)}`
}
