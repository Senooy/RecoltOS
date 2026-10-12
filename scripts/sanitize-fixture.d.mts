/** Types of `sanitize-fixture.mjs` (used by the TypeScript tests). */
export interface SanitizeOptions {
  /** Additional structural object keys to keep as they are. */
  keepKeys?: string[]
}

export interface Sanitizer {
  (data: unknown): unknown
  /** Strings (keys and values) deliberately kept as they are. */
  survivors: Set<string>
  /** Unknown keys renamed to `champ_N` (do not log without `--report-keys`). */
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
