/**
 * Propriétés (fast-check) des parseurs de sync (WP-55) : JSON arbitraire → `{ ok:false, error }` ou
 * page cohérente, jamais d'exception ; fixtures mutées au hasard → entrées isolées, invariants tenus.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  parseCosmosSavesPage,
  parseInstagramMediaInfo,
  parseInstagramSavedPage,
  parseXBookmarksPage,
  type PageParseResult,
} from '../../../../src/main/sync/parsers'
import { checkInvariants, fixture, fixtureNames, type Dir } from './helpers'

const PARSERS: Record<Dir, (j: unknown) => PageParseResult> = {
  x: (j) => parseXBookmarksPage(j),
  instagram: (j) => parseInstagramSavedPage(j),
  cosmos: (j) => parseCosmosSavesPage(j),
}
const ALL = [...Object.values(PARSERS), (j: unknown) => parseInstagramMediaInfo(j)]

function safe(parse: (j: unknown) => PageParseResult, input: unknown): PageParseResult {
  let r: PageParseResult | undefined
  expect(() => {
    r = parse(input)
  }).not.toThrow()
  checkInvariants(r!)
  return r!
}

/** Chemins [parent, clé] de tous les nœuds d'un JSON. */
function paths(root: unknown): [Record<string, unknown> | unknown[], string | number][] {
  const out: [Record<string, unknown> | unknown[], string | number][] = []
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      v.forEach((c, i) => {
        out.push([v, i])
        walk(c)
      })
    } else if (typeof v === 'object' && v !== null) {
      for (const [k, c] of Object.entries(v)) {
        out.push([v as Record<string, unknown>, k])
        walk(c)
      }
    }
  }
  walk(root)
  return out
}

type Mutation = { at: number; op: 'delete' | 'replace' | 'rename'; value: unknown }

function mutate(root: unknown, muts: Mutation[]): unknown {
  const copy = structuredClone(root)
  for (const m of muts) {
    const all = paths(copy)
    if (all.length === 0) break
    const [parent, key] = all[m.at % all.length]!
    if (Array.isArray(parent)) {
      const i = key as number
      if (m.op === 'delete') parent.splice(i, 1)
      else parent[i] = m.value
    } else {
      const k = key as string
      if (m.op === 'delete') delete parent[k]
      else if (m.op === 'rename') {
        parent[`${k}_renomme`] = parent[k]
        delete parent[k]
      } else parent[k] = m.value
    }
  }
  return copy
}

const mutation = fc.record({
  at: fc.nat(),
  op: fc.constantFrom<Mutation['op']>('delete', 'replace', 'rename'),
  value: fc.oneof(fc.jsonValue({ maxDepth: 2 }), fc.constant(null), fc.constant('javascript:x')),
})

describe('propriétés des parseurs', () => {
  it('JSON arbitraire : jamais d’exception, erreur classée ou page cohérente', () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 6 }), (j) => {
        for (const p of ALL) safe(p, j)
      }),
      { numRuns: 300 },
    )
  })

  it('valeurs JavaScript quelconques (objets exotiques compris) : jamais d’exception', () => {
    fc.assert(
      fc.property(
        fc.anything({ maxDepth: 4, withMap: true, withSet: true, withBigInt: true }),
        (j) => {
          for (const p of ALL) safe(p, j)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('JSON arbitraire sous les racines attendues : jamais d’exception', () => {
    const wrap = (dir: Dir, v: unknown) =>
      dir === 'x'
        ? {
            data: {
              bookmark_timeline_v2: {
                timeline: { instructions: [{ type: 'TimelineAddEntries', entries: v }] },
              },
            },
          }
        : dir === 'instagram'
          ? { items: v, more_available: true, next_max_id: 'c' }
          : { data: { allElementsV2: { items: v, meta: { nextPageCursor: 'c' } } } }
    fc.assert(
      fc.property(
        fc.constantFrom<Dir>('x', 'instagram', 'cosmos'),
        fc.array(fc.jsonValue({ maxDepth: 5 }), { maxLength: 8 }),
        (dir, entries) => {
          const r = safe(PARSERS[dir], wrap(dir, entries))
          expect(r.ok).toBe(true)
        },
      ),
      { numRuns: 300 },
    )
  })

  for (const dir of ['x', 'instagram', 'cosmos'] as Dir[]) {
    it(`fixtures ${dir} mutées au hasard : invariants tenus`, () => {
      const pages = fixtureNames(dir).map((n) => fixture(dir, n))
      fc.assert(
        fc.property(
          fc.nat({ max: pages.length - 1 }),
          fc.array(mutation, { minLength: 1, maxLength: 4 }),
          (i, muts) => {
            safe(PARSERS[dir], mutate(pages[i], muts))
          },
        ),
        { numRuns: 400 },
      )
    })
  }

  it('entrée arbitraire insérée dans une page valide : les publications d’origine restent', () => {
    const base = fixture('x', 'curseur-page1.json') as {
      data: { bookmark_timeline_v2: { timeline: { instructions: { entries: unknown[] }[] } } }
    }
    const keys = (r: PageParseResult) => (r.ok ? r.posts.map((p) => p.sourceKey) : [])
    const expected = keys(parseXBookmarksPage(base))
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 5 }), fc.nat({ max: 21 }), (junk, at) => {
        const j = structuredClone(base)
        j.data.bookmark_timeline_v2.timeline.instructions[0]!.entries.splice(at, 0, junk)
        const r = safe(parseXBookmarksPage, j)
        expect(keys(r).filter((k) => expected.includes(k))).toEqual(expected)
        expect(r.ok && r.nextCursor).toBe('Q1VSU09SLXBhZ2Uy')
      }),
      { numRuns: 200 },
    )
  })
})
