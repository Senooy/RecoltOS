/**
 * Briques communes des repos : horloge injectable, listes d'ids passées en JSON (`json_each`),
 * colonnes JSON et booléens SQLite.
 */
import type Database from 'better-sqlite3'
import { preparedFor, type Prepared } from '../open'

export type Clock = () => number

export interface RepoOptions {
  /** Horloge (ms epoch) ; injectée dans les tests. */
  now?: Clock
}

export interface RepoBase {
  db: Database.Database
  q: Prepared
  now: Clock
}

export function repoBase(db: Database.Database, opts: RepoOptions = {}): RepoBase {
  return { db, q: preparedFor(db), now: opts.now ?? Date.now }
}

/** Liste d'ids pour `IN (SELECT value FROM json_each(?))` (une seule requête préparée). */
export function idList(ids: readonly number[]): string {
  return JSON.stringify(ids.filter((n) => Number.isInteger(n)))
}

export function toJson(v: unknown): string | null {
  return v === null || v === undefined ? null : JSON.stringify(v)
}

export function fromJson<T>(v: string | null | undefined): T | null {
  if (v === null || v === undefined) return null
  try {
    return JSON.parse(v) as T
  } catch {
    return null
  }
}

export function toBool(v: boolean | number | null | undefined): number | null {
  if (v === null || v === undefined) return null
  return v ? 1 : 0
}

/** Découpe un tableau en tranches (lots d'insertion). */
export function chunks<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Construit `SET a = @a, b = @b` depuis un patch camelCase, en ne gardant que les colonnes connues.
 * Les valeurs passent par `encode` (JSON, booléens). Renvoie `null` si rien à mettre à jour.
 */
export function buildSet<K extends string>(
  patch: Partial<Record<K, unknown>>,
  columns: Readonly<Record<K, ColumnSpec>>,
): { sql: string; params: Record<string, unknown> } | null {
  const sets: string[] = []
  const params: Record<string, unknown> = {}
  for (const key of Object.keys(patch) as K[]) {
    const spec = columns[key]
    const value = patch[key]
    if (!spec || value === undefined) continue
    sets.push(`${spec.col} = @${spec.col}`)
    params[spec.col] = encode(spec, value)
  }
  return sets.length > 0 ? { sql: sets.join(', '), params } : null
}

export interface ColumnSpec {
  col: string
  kind?: 'json' | 'bool'
}

export function encode(spec: ColumnSpec, value: unknown): unknown {
  if (spec.kind === 'json') return toJson(value)
  if (spec.kind === 'bool') return toBool(value as boolean | null)
  return value
}
