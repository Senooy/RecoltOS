/** Types de `sanitize-fixture.mjs` (utilisés par les tests TypeScript). */
export interface SanitizeOptions {
  /** Clés d'objet structurelles supplémentaires à conserver telles quelles. */
  keepKeys?: string[]
}

export interface Sanitizer {
  (data: unknown): unknown
  /** Chaînes (clés et valeurs) conservées volontairement telles quelles. */
  survivors: Set<string>
  /** Clés inconnues renommées en `champ_N` (à ne pas journaliser sans `--report-keys`). */
  renamedKeys: Set<string>
}

export const KNOWN_KEYS: Set<string>
export function makeSanitizer(options?: SanitizeOptions): Sanitizer
export function findLeaks(
  source: unknown,
  clean: unknown,
  allowed?: Set<string>,
  minLength?: number,
): string[]
export function assertNoLeak(source: unknown, clean: unknown, allowed?: Set<string>): void
export function sanitize(data: unknown, options?: SanitizeOptions): unknown
