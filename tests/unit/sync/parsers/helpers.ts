/**
 * Helpers for the sync parser tests: reading fixtures and invariants
 * shared by every parser output.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'vitest'
import type { PageParseOk, PageParseResult } from '../../../../src/main/sync/parsers'
import { PostMetaSchema } from '../../../../src/shared/post-meta'

export const FIXTURES = join(import.meta.dirname, '../../../fixtures/sync')

export type Dir = 'x' | 'instagram' | 'cosmos'

export function fixture(dir: Dir, name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, dir, name), 'utf8')) as unknown
}

/** Mutable deep copy of a fixture. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mutable(dir: Dir, name: string): any {
  return structuredClone(fixture(dir, name))
}

export function fixtureNames(dir: Dir): string[] {
  return readdirSync(join(FIXTURES, dir))
    .filter((n) => n.endsWith('.json'))
    .sort()
}

export function expectOk(r: PageParseResult): PageParseOk {
  if (!r.ok) throw new Error(`unexpected failure: ${JSON.stringify(r.error)}`)
  return r
}

const KEY = /^(x|ig|cosmos):[A-Za-z0-9_-]+$/

/** Invariants of any output: never an upstream exception, consistent counts, post_meta v1. */
export function checkInvariants(r: PageParseResult): void {
  expect(typeof r.ok).toBe('boolean')
  if (!r.ok) {
    expect(['auth_required', 'rate_limited', 'api_changed']).toContain(r.error.code)
    expect(typeof r.error.reason).toBe('string')
    return
  }
  const s = r.stats
  expect(s.parsed).toBe(r.posts.length)
  expect(s.entries).toBe(s.parsed + s.unavailable + s.ignored + s.malformed)
  expect(r.nextCursor === null || typeof r.nextCursor === 'string').toBe(true)
  const keys = new Set<string>()
  r.posts.forEach((p, i) => {
    expect(p.platform).toBe(r.platform)
    expect(p.sourceKey).toMatch(KEY)
    expect(keys.has(p.sourceKey)).toBe(false)
    keys.add(p.sourceKey)
    expect(p.position).toBe(i)
    expect(p.createdAt).toBeNull()
    expect(PostMetaSchema.safeParse(p.postMeta).success).toBe(true)
    expect(p.postMeta.v).toBe(1)
    expect(p.sourceUrl.startsWith('https://')).toBe(true)
    if (p.author?.handle) expect(p.author.handle.startsWith('@')).toBe(false)
    for (const m of p.media) {
      for (const u of [m.url, m.hlsUrl, m.posterUrl, m.fallbackUrl]) {
        if (u !== null) expect(u.startsWith('https://')).toBe(true)
      }
      expect(m.url !== null || m.hlsUrl !== null).toBe(true)
    }
    if (p.media.length > 0) expect(p.kind === 'url' || p.kind === p.media[0]!.type).toBe(true)
  })
}
