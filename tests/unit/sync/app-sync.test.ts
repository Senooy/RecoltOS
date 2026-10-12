/**
 * Sync côté app : ordre, budgets, ingestion d'une page (post_meta v1, aucune URL http(s)
 * dans `ItemCard`), règle d'arrêt, éléments écartés, publication de l'extension, téléchargeur, import.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cardRowsByIds } from '../../../src/main/db/queries/list'
import { toItemCard } from '../../../src/main/dto/item-card'
import { policyFor } from '../../../src/main/jobs/fetch'
import { libraryPaths } from '../../../src/main/library/paths'
import type { LibraryContext } from '../../../src/main/library/library-context'
import { PlatformBudget } from '../../../src/main/sync/budget'
import { refererFor, registerSyncFetchPolicies } from '../../../src/main/sync/downloader'
import { prefillAfterImport } from '../../../src/main/sync/import-prefill'
import { ingestPage } from '../../../src/main/sync/ingest'
import { assignCreatedAt, startOrder, type Known } from '../../../src/main/sync/order'
import { parseSyncPage, type NormalizedPost } from '../../../src/main/sync/parsers'
import { postFromRequest } from '../../../src/main/sync/post-from-request'
import { DEFAULT_PREFS } from '../../../src/shared/prefs'
import { PostMetaSchema } from '../../../src/shared/post-meta'
import { openTestLib, T0, type TestLib } from '../db/helpers'

const FIX = join(import.meta.dirname, '../../fixtures/sync')
const fx = (p: string) => JSON.parse(readFileSync(join(FIX, p), 'utf8')) as unknown

function posts(platform: 'x' | 'instagram' | 'cosmos', file: string): NormalizedPost[] {
  const r = parseSyncPage(platform, fx(file))
  if (!r.ok) throw new Error(r.error.reason)
  return r.posts
}

let t: TestLib
let lib: LibraryContext
beforeEach(() => {
  t = openTestLib()
  lib = {
    id: 'ltest',
    name: 'Test',
    root: t.root,
    paths: libraryPaths(t.root),
    db: t.db,
    repos: t.repos,
  }
})
afterEach(() => t.cleanup())

const svc = () => ({ lib, prefs: () => DEFAULT_PREFS, now: () => t.clock.now })

describe('ordre (order.ts)', () => {
  const k = (map: Record<string, Known>) => (key: string) => map[key] ?? { state: 'new' as const }

  it('incrémental : nouveautés en tête dans l’ordre de la plateforme, ancre fixe', () => {
    const cur = startOrder('incremental', { backfill_anchor_at: null, backfill_pos: 0 }, 10_000)
    const out = assignCreatedAt(
      'incremental',
      [{ sourceKey: 'a' }, { sourceKey: 'old' }, { sourceKey: 'b' }],
      cur,
      k({ old: { state: 'saved', createdAt: 100 } }),
      10_000,
    )
    expect(out.map((o) => [o.sourceKey, o.createdAt])).toEqual([
      ['a', 9_999],
      ['b', 9_998],
    ])
  })

  it('backfill : recalage 1 ms sous le voisin connu, ancre persistée entre tranches, marque recovered', () => {
    const st = { backfill_anchor_at: null as number | null, backfill_pos: 0 }
    const cur = startOrder('backfill', st, 50_000)
    const lookup = k({
      n1: { state: 'saved', createdAt: 20_000 },
      n2: { state: 'saved', createdAt: 19_000 },
    })
    const t1 = assignCreatedAt(
      'backfill',
      [{ sourceKey: 'n1' }, { sourceKey: 'a' }, { sourceKey: 'b' }],
      cur,
      lookup,
      50_000,
    )
    expect(t1.map((o) => o.createdAt)).toEqual([19_999, 19_998])
    expect(t1.every((o) => o.recovered)).toBe(true)
    // Tranche suivante : reprise depuis l'ancre persistée.
    const cur2 = startOrder(
      'backfill',
      { backfill_anchor_at: cur.anchorAt, backfill_pos: cur.pos },
      60_000,
    )
    const t2 = assignCreatedAt(
      'backfill',
      [{ sourceKey: 'c' }, { sourceKey: 'n2' }, { sourceKey: 'd' }],
      cur2,
      lookup,
      60_000,
    )
    expect(t2.map((o) => [o.sourceKey, o.createdAt])).toEqual([
      ['c', 19_997],
      ['d', 18_999],
    ])
  })

  it('voisins importés à 1 s d’écart : les rattrapés s’intercalent dans l’ordre', () => {
    const cur = startOrder('backfill', { backfill_anchor_at: null, backfill_pos: 0 }, 99_000)
    const out = assignCreatedAt(
      'backfill',
      [{ sourceKey: 'v1' }, { sourceKey: 'x1' }, { sourceKey: 'x2' }, { sourceKey: 'v2' }],
      cur,
      k({ v1: { state: 'saved', createdAt: 2_000 }, v2: { state: 'saved', createdAt: 1_000 } }),
      99_000,
    )
    const times = [2_000, ...out.map((o) => o.createdAt), 1_000]
    expect([...times].sort((a, b) => b - a)).toEqual(times)
  })

  it('remise en favori d’un ancien (connu) : n’entraîne pas les suivants en incrémental', () => {
    const cur = startOrder('incremental', { backfill_anchor_at: null, backfill_pos: 0 }, 5_000)
    const out = assignCreatedAt(
      'incremental',
      [{ sourceKey: 'old' }, { sourceKey: 'new' }],
      cur,
      k({ old: { state: 'saved', createdAt: 10 } }),
      5_000,
    )
    expect(out).toEqual([{ sourceKey: 'new', createdAt: 4_999, recovered: false }])
  })
})

describe('budget Instagram', () => {
  it('21e page du run refusée ; cooldown partagé bloque aussi le refresh ; plafond du jour', () => {
    let saved = null as unknown
    const b = new PlatformBudget(
      'instagram',
      { budgetDay: null, budgetUsed: 0, cooldownUntil: null, cooldowns: 0 },
      (s) => (saved = s),
      { random: () => 0 },
    )
    b.startRun()
    let now = T0
    for (let i = 0; i < 20; i++) {
      const c = b.check('page', now)
      expect(c.ok).toBe(true)
      b.spend('page', now)
      now += 3_000
    }
    expect(b.check('page', now)).toEqual({ ok: false, reason: 'run' })
    expect(b.check('refresh', now).ok).toBe(true)
    const until = b.cooldown(now)
    expect(until - now).toBe(30 * 60_000)
    expect(b.check('refresh', now + 1_000)).toMatchObject({ ok: false, reason: 'cooldown' })
    expect(b.cooldown(now) - now).toBe(60 * 60_000)
    expect(saved).toMatchObject({ budgetUsed: 20 })
    const day = new PlatformBudget(
      'instagram',
      { budgetDay: null, budgetUsed: 0, cooldownUntil: null, cooldowns: 0 },
      () => undefined,
    )
    for (let i = 0; i < 200; i++) day.spend('refresh', T0)
    expect(day.check('refresh', T0 + 10_000)).toEqual({ ok: false, reason: 'day' })
  })

  it('écart de 3 à 6 s entre deux appels', () => {
    const b = new PlatformBudget(
      'instagram',
      { budgetDay: null, budgetUsed: 0, cooldownUntil: null, cooldowns: 0 },
      () => undefined,
      { random: () => 0.5 },
    )
    b.spend('page', T0)
    expect(b.check('page', T0 + 1_000)).toEqual({ ok: true, waitMs: 3_500 })
  })
})

describe('ingestion d’une page', () => {
  it('20 tweets : items + post_meta v1 valides, médias distants, jobs, aucune URL http(s) dans ItemCard', () => {
    const page = posts('x', 'x/curseur-page1.json')
    expect(page).toHaveLength(20)
    const r = ingestPage(svc(), {
      platform: 'x',
      mode: 'incremental',
      posts: page,
      order: { anchorAt: T0, pos: 0 },
      runStartedAt: T0,
    })
    expect(r.stats).toEqual({ parsed: 20, new: 20, known: 0, dismissed: 0 })
    const rows = t.db
      .prepare(
        "SELECT id, post_meta, kind, origin FROM items WHERE source = 'x' ORDER BY created_at DESC",
      )
      .all() as {
      id: number
      post_meta: string
      kind: string
      origin: string
    }[]
    expect(rows).toHaveLength(20)
    for (const row of rows) {
      expect(PostMetaSchema.safeParse(JSON.parse(row.post_meta)).success).toBe(true)
      expect(row.origin).toBe('sync')
    }
    const cards = cardRowsByIds(
      t.db,
      rows.map((x) => x.id),
    ).map((c) => toItemCard(lib, c))
    expect(JSON.stringify(cards)).not.toMatch(/https?:\/\//)
    const jobs = t.db
      .prepare("SELECT count(*) AS n FROM jobs WHERE type = 'media.download'")
      .get() as { n: number }
    expect(jobs.n).toBe(15)
    expect(
      (
        t.db.prepare("SELECT count(*) AS n FROM item_media WHERE status = 'remote'").get() as {
          n: number
        }
      ).n,
    ).toBe(15)
    // Ordre : le premier de la page est le plus récent.
    expect(r.createdUuids).toHaveLength(20)
    const again = ingestPage(svc(), {
      platform: 'x',
      mode: 'incremental',
      posts: page,
      order: { anchorAt: T0 + 5, pos: 0 },
      runStartedAt: T0 + 5,
    })
    expect(again.stats.new).toBe(0)
    expect(again.stopIncremental).toBe(true)
  })

  it('carrousel Instagram de 10 : un élément, 10 médias (badge 1/10)', () => {
    ingestPage(svc(), {
      platform: 'instagram',
      mode: 'incremental',
      posts: posts('instagram', 'instagram/carrousel.json'),
      order: { anchorAt: T0, pos: 0 },
      runStartedAt: T0,
    })
    const it = t.db
      .prepare("SELECT media_count, kind FROM items WHERE source = 'instagram'")
      .get() as { media_count: number; kind: string }
    expect(it).toEqual({ media_count: 10, kind: 'image' })
  })

  it('suppression définitive (écarté) : jamais réimporté, même par le backfill', () => {
    const page = posts('x', 'x/simple.json')
    ingestPage(svc(), {
      platform: 'x',
      mode: 'incremental',
      posts: page,
      order: { anchorAt: T0, pos: 0 },
      runStartedAt: T0,
    })
    const id = (t.db.prepare("SELECT id FROM items WHERE source = 'x'").get() as { id: number }).id
    t.repos.items.trash([id])
    t.db.prepare('DELETE FROM items WHERE id = ?').run(id)
    const r = ingestPage(svc(), {
      platform: 'x',
      mode: 'backfill',
      posts: page,
      order: { anchorAt: T0, pos: 0 },
      runStartedAt: T0,
    })
    expect(r.stats).toMatchObject({ new: 0, dismissed: 1 })
    expect(
      (t.db.prepare("SELECT count(*) AS n FROM items WHERE source = 'x'").get() as { n: number }).n,
    ).toBe(0)
  })

  it('élément importé de GatherOS (même external_id) : reconnu, pas de doublon', () => {
    const p = posts('x', 'x/simple.json')[0]!
    t.repos.items.insert({
      kind: 'tweet',
      source: 'x',
      externalId: p.externalId,
      origin: 'gatheros',
      originId: 'g1',
      createdAt: T0 - 1000,
    })
    const r = ingestPage(svc(), {
      platform: 'x',
      mode: 'backfill',
      posts: [p],
      order: { anchorAt: T0, pos: 0 },
      runStartedAt: T0,
    })
    expect(r.stats).toMatchObject({ new: 0, known: 1 })
  })
})

describe('publication enregistrée depuis l’extension', () => {
  it('donnée brute X → publication normalisée ; repli DOM partiel', () => {
    const page = fx('x/simple.json') as {
      data: {
        bookmark_timeline_v2: {
          timeline: {
            instructions: {
              entries: { content: { itemContent?: { tweet_results: { result: unknown } } } }[]
            }[]
          }
        }
      }
    }
    const raw =
      page.data.bookmark_timeline_v2.timeline.instructions[0]!.entries[0]!.content.itemContent!
        .tweet_results.result
    const p = postFromRequest({
      kind: 'post',
      pageUrl: 'https://x.com/a/status/1',
      post: { platform: 'x', externalId: '1870000000000000001', raw },
    })
    expect(p?.sourceKey).toBe('x:1870000000000000001')
    const dom = postFromRequest({
      kind: 'post',
      pageUrl: 'https://www.instagram.com/p/ABC/',
      post: {
        platform: 'instagram',
        externalId: 'ABC',
        dom: { imageUrls: ['https://scontent.cdninstagram.com/a.jpg', 'http://bad'] },
        partial: true,
      },
    })
    expect(dom?.kind).toBe('image')
    expect(dom?.media).toHaveLength(1)
    expect(PostMetaSchema.safeParse(dom?.postMeta).success).toBe(true)
  })
})

describe('téléchargeur', () => {
  it('Referer par CDN, aucun cookie ; HLS confié à ffmpeg ; 403 Instagram → refresh', () => {
    expect(refererFor(new URL('https://pbs.twimg.com/media/a.jpg'))).toBe('https://x.com/')
    expect(refererFor(new URL('https://scontent-cdg4-1.cdninstagram.com/x.jpg'))).toBe(
      'https://www.instagram.com/',
    )
    expect(refererFor(new URL('https://cdn.cosmos.so/u'))).toBe('https://www.cosmos.so/')
    const expired: string[] = []
    const off = registerSyncFetchPolicies({ ffmpeg: () => null, onExpired: (u) => expired.push(u) })
    const pol = policyFor('https://scontent.cdninstagram.com/a.jpg')
    expect(pol.headers?.Referer).toBe('https://www.instagram.com/')
    expect(JSON.stringify(pol.headers)).not.toMatch(/cookie/i)
    pol.onAuthError?.(403, 'https://scontent.cdninstagram.com/a.jpg')
    expect(expired).toEqual(['https://scontent.cdninstagram.com/a.jpg'])
    expect(policyFor('https://video.twimg.com/a/pl.m3u8').download).toBeTypeOf('function')
    expect(policyFor('https://example.com/a.jpg').headers).toBeUndefined()
    off()
  })
})

describe('import GatherOS', () => {
  it('backfill programmé pour chaque plateforme, réglages notés sans activation', () => {
    t.repos.sync.patchState('x', { backfillDone: true, backfillCursor: 'C' })
    prefillAfterImport(lib, { x: true, instagram: false }, T0)
    expect(t.repos.sync.getState('x')).toMatchObject({
      backfill_done: 0,
      backfill_cursor: null,
      enabled: 0,
    })
    expect(t.repos.settings.get('sync.importedFlags')).toEqual({ x: true, instagram: false })
  })
})
