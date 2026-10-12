/**
 * Banc de la grille et des requêtes (QA §6.4, §11.3 ; WP-71) — projet Playwright `perf`.
 *   G1 : défilement de la grille pendant 5 s (sonde rAF, `longtask`), tas renderer après un
 *        défilement complet + 20 ouvertures de la vue détail, croissance sur 5 cycles.
 *   G2 : requêtes à travers l'IPC (page de liste, compteurs, FTS), 30 répétitions, p50 / p95.
 * Bibliothèque : `RECOLTOS_PERF_USERDATA` (clone APFS de la bibliothèque réelle, ou sortie de
 * `scripts/seed-bench.mts` pour 10 000 éléments), sinon démo de 408 éléments. Densité :
 * `RECOLTOS_PERF_DSF=2` pour le Retina. Rapport : `.tmp/m7-perf-grid.json` (fusionné).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from '../helpers/e2e-fixtures'
import { REPO_ROOT } from '../helpers/paths'

const t = (id: string) => `[data-testid="${id}"]`
const userData = process.env.RECOLTOS_PERF_USERDATA
const dsf = process.env.RECOLTOS_PERF_DSF === '2' ? 2 : 1
const label = process.env.RECOLTOS_PERF_LABEL ?? (userData ? path.basename(userData) : 'demo-408')
const REPORT = path.join(REPO_ROOT, '.tmp/m7-perf-grid.json')
const report: Record<string, unknown> = {}

test.describe.configure({ mode: 'serial' })
test.use(
  userData
    ? { appLaunch: { userData, windowSize: '1512x945', deviceScaleFactor: dsf } }
    : {
        demoLibrary: { count: 408, collections: 4 },
        appLaunch: { windowSize: '1512x945', deviceScaleFactor: dsf },
      },
)

test.afterAll(() => {
  fs.mkdirSync(path.dirname(REPORT), { recursive: true })
  const prev = fs.existsSync(REPORT)
    ? (JSON.parse(fs.readFileSync(REPORT, 'utf8')) as Record<string, unknown>)
    : {}
  prev[`${label}@${dsf}x`] = { at: new Date().toISOString(), ...report }
  fs.writeFileSync(REPORT, JSON.stringify(prev, null, 2))
})

const invoke = (page: Page, channel: string, input?: unknown) =>
  page.evaluate(
    ([c, i]) =>
      (
        window as unknown as { recolt: { invoke: (c: string, i: unknown) => Promise<unknown> } }
      ).recolt.invoke(c, i),
    [channel, input] as const,
  ) as Promise<{ ok: boolean; data: unknown; error?: { message: string } }>

const pct = (v: number[], p: number) => {
  const s = [...v].sort((a, b) => a - b)
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]! * 100) / 100
}

async function heapMb(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('HeapProfiler.collectGarbage')
  await cdp.send('Performance.enable')
  const { metrics } = await cdp.send('Performance.getMetrics')
  await cdp.detach()
  const used = metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0
  return Math.round((used / 2 ** 20) * 10) / 10
}

test('G1 : défilement 5 s, longtasks, tas après défilement complet + 20 détails', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible({
    timeout: 30_000,
  })
  await page.waitForTimeout(1500)
  // Sonde : défilement continu (≈ 2 400 px/s, aller puis retour) pendant 5 s.
  const probe = await page.evaluate(
    (ms) =>
      new Promise<{ frames: number[]; longtasks: number[]; scrolled: number }>((resolve) => {
        const sc = document.querySelector<HTMLElement>('[data-testid="library-scroll"]')!
        const longtasks: number[] = []
        const obs = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) longtasks.push(e.duration)
        })
        obs.observe({ type: 'longtask', buffered: false })
        const frames: number[] = []
        let dir = 1
        let last = performance.now()
        const t0 = last
        let scrolled = 0
        const tick = (now: number) => {
          frames.push(now - last)
          last = now
          const max = sc.scrollHeight - sc.clientHeight
          if (sc.scrollTop >= max - 1) dir = -1
          else if (sc.scrollTop <= 0) dir = 1
          sc.scrollTop += 40 * dir
          scrolled += 40
          if (now - t0 < ms) requestAnimationFrame(tick)
          else {
            obs.disconnect()
            resolve({ frames: frames.slice(5), longtasks, scrolled })
          }
        }
        requestAnimationFrame(tick)
      }),
    5000,
  )
  const f = probe.frames
  const avg = f.reduce((a, b) => a + b, 0) / f.length
  const scroll = {
    frames: f.length,
    fps: Math.round((1000 / avg) * 10) / 10,
    p95ms: pct(f, 0.95),
    p99ms: pct(f, 0.99),
    over50pct: Math.round((f.filter((x) => x > 50).length / f.length) * 1000) / 10,
    longtasksOver100: probe.longtasks.filter((d) => d > 100).length,
    longestTaskMs: Math.round(Math.max(0, ...probe.longtasks)),
    scrolledPx: probe.scrolled,
  }
  // Défilement complet (haut → bas → haut), par écrans.
  await page.evaluate(async () => {
    const sc = document.querySelector<HTMLElement>('[data-testid="library-scroll"]')!
    const step = sc.clientHeight
    for (let y = 0; y <= sc.scrollHeight; y += step) {
      sc.scrollTop = y
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    }
    sc.scrollTop = 0
    await new Promise((r) => setTimeout(r, 300))
  })
  const heapAfterScroll = await heapMb(page)
  // 20 ouvertures de la vue détail, puis 5 cycles de 4 ouvertures (croissance).
  const openClose = async (n: number) => {
    for (let i = 0; i < n; i++) {
      const card = page.locator(`${t('grid')} ${t('card')}`).nth(i % 12)
      await card.click()
      await expect(page.locator(t('detail'))).toBeVisible()
      await page.waitForTimeout(150)
      await page.keyboard.press('Escape')
      await expect(page.locator(t('detail'))).toHaveCount(0)
    }
  }
  await openClose(20)
  const heapAfter20 = await heapMb(page)
  const cycles: number[] = []
  for (let c = 0; c < 5; c++) {
    await openClose(4)
    cycles.push(await heapMb(page))
  }
  const growthPct = Math.round(((cycles[4]! - cycles[0]!) / cycles[0]!) * 1000) / 10
  const items = await page.locator(`${t('grid')} ${t('card')}`).count()
  report.g1 = { dsf, mountedCards: items, scroll, heapAfterScroll, heapAfter20, cycles, growthPct }
  console.warn('G1', JSON.stringify(report.g1))
  expect(scroll.fps).toBeGreaterThanOrEqual(55)
  expect(scroll.p95ms).toBeLessThanOrEqual(22)
  expect(heapAfter20).toBeLessThan(400)
  expect(growthPct).toBeLessThan(15)
})

test('G2 : page de liste, compteurs, FTS à travers l’IPC', async ({ page }) => {
  test.setTimeout(120_000)
  await expect(page.locator(t('app-shell'))).toBeVisible()
  const time = async (channel: string, input: unknown, n = 30) => {
    const v: number[] = []
    for (let i = 0; i < n + 3; i++) {
      const r = await page.evaluate(
        async ([c, inp]) => {
          const s = performance.now()
          const res = (await (
            window as unknown as {
              recolt: { invoke: (c: string, i: unknown) => Promise<{ ok: boolean }> }
            }
          ).recolt.invoke(c, inp)) as { ok: boolean; error?: { message: string } }
          return { ms: performance.now() - s, ok: res.ok, err: res.error?.message }
        },
        [channel, input] as const,
      )
      expect(r.ok, r.err).toBe(true)
      if (i >= 3) v.push(r.ms)
    }
    return { p50ms: pct(v, 0.5), p95ms: pct(v, 0.95), maxms: pct(v, 1) }
  }
  const total = await invoke(page, 'items.counts', {})
  const page1 = (await invoke(page, 'items.list', { scope: 'library', tab: 'all', limit: 100 }))
    .data as { nextCursor: string | null }
  const queries = {
    counts: total.data,
    listFirstPage: await time('items.list', { scope: 'library', tab: 'all', limit: 100 }),
    listNextPage: page1.nextCursor
      ? await time('items.list', {
          scope: 'library',
          tab: 'all',
          limit: 100,
          cursor: page1.nextCursor,
        })
      : null,
    listOldest: await time('items.list', {
      scope: 'library',
      tab: 'all',
      limit: 100,
      sort: 'oldest',
    }),
    counters: await time('items.counts', {}),
    ftsShort: await time('search.query', { q: 'ar', limit: 300 }),
    ftsWord: await time('search.query', { q: 'design', limit: 300 }),
    ftsTwoWords: await time('search.query', { q: 'photo lumière', limit: 300 }),
  }
  report.g2 = queries
  console.warn('G2', JSON.stringify(queries))
  expect(queries.listFirstPage.p95ms).toBeLessThan(20)
  expect(queries.ftsWord.p95ms).toBeLessThan(30)
})
