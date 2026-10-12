/**
 * Smoothness of the detail view and the shelf — Playwright project `perf` (outside `verify`).
 *   V1: detail view, open then 6 ←/→ navigations over images and videos. Pass 1: rAF probe and
 *        `longtask` (no capture): no frame > 50 ms except the first opening. Pass 2: captures
 *        from the compositor (`Page.startScreencast`) during the ambient fades, sampled: no
 *        dark flat area (bare or black background, unrasterized tile) where the stable frame
 *        shows a colored ambiance, excluding media and panel; and, via a `cc` trace, no missing
 *        tile drawn nor insufficient tile memory.
 *   E1: collections shelf, 3 cascading entries + hover over 5 slices: p95 ≤ 20 ms, no
 *        `longtask`; traced control pass: no missing tile drawn.
 * REAL animations: the `data-e2e` attribute (which disables them) is removed before opening
 * the views.
 * Library: `RECOLTOS_PERF_USERDATA` (APFS clone of the real library), otherwise demo.
 * Density: 2 (Retina) by default, `RECOLTOS_PERF_DSF=1` otherwise. Captures (if
 * `RECOLTOS_PERF_SHOTS=folder`: worst holed frame and one full-fade frame per step) and report:
 * `.tmp/m8-perf-gfx.json` (key `RECOLTOS_PERF_LABEL`, resident memory and footprint per process).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '../helpers/e2e-fixtures'
import { REPO_ROOT } from '../helpers/paths'

const t = (id: string) => `[data-testid="${id}"]`
const userData = process.env.RECOLTOS_PERF_USERDATA
const dsf = process.env.RECOLTOS_PERF_DSF === '1' ? 1 : 2
const label = process.env.RECOLTOS_PERF_LABEL ?? (userData ? path.basename(userData) : 'demo')
const shots = process.env.RECOLTOS_PERF_SHOTS
const REPORT = path.join(REPO_ROOT, '.tmp/m8-perf-gfx.json')
const report: Record<string, unknown> = {}

test.describe.configure({ mode: 'serial' })
test.use(
  userData
    ? { appLaunch: { userData, windowSize: '1512x945', deviceScaleFactor: dsf } }
    : {
        demoLibrary: { count: 60, collections: 8 },
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

const pct = (v: number[], p: number) => {
  if (!v.length) return 0
  const s = [...v].sort((a, b) => a - b)
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]! * 10) / 10
}

/** Real animations: without `data-e2e`, the views read the motion on mount. */
async function enableMotion(page: Page) {
  await page.evaluate(() => {
    delete document.documentElement.dataset.e2e
  })
}

/** rAF + `longtask` probe: starts now, `stop()` returns the frame durations. */
async function startProbe(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __probe?: { frames: number[]; long: number[]; on: boolean }
    }
    const probe = { frames: [] as number[], long: [] as number[], on: true }
    w.__probe = probe
    let last = performance.now()
    const tick = (now: number) => {
      probe.frames.push(now - last)
      last = now
      if (probe.on) requestAnimationFrame(tick)
    }
    requestAnimationFrame((now) => {
      last = now
      requestAnimationFrame(tick)
    })
    new PerformanceObserver((l) => {
      if (probe.on) for (const e of l.getEntries()) probe.long.push(e.duration)
    }).observe({ type: 'longtask', buffered: false })
  })
  return async () =>
    page.evaluate(() => {
      const p = (
        window as unknown as { __probe: { frames: number[]; long: number[]; on: boolean } }
      ).__probe
      p.on = false
      return { frames: p.frames, long: p.long }
    })
}

function frameStats(f: number[]) {
  return {
    frames: f.length,
    p50ms: pct(f, 0.5),
    p95ms: pct(f, 0.95),
    maxms: Math.round(Math.max(0, ...f) * 10) / 10,
    over50: f.filter((d) => d > 50).length,
    over20: f.filter((d) => d > 20).length,
  }
}

/** Memory per process type (MB, resident). */
/** Physical footprint (MB) of each process, read by `top` (MEM column, GPU textures included). */
function footprintMb(pids: number[]): Map<number, number> {
  const out = execFileSync(
    'top',
    ['-l', '1', '-stats', 'pid,mem', ...pids.flatMap((p) => ['-pid', String(p)])],
    { encoding: 'utf8' },
  )
  const unit: Record<string, number> = { B: 1 / 2 ** 20, K: 1 / 1024, M: 1, G: 1024 }
  const mb = new Map<number, number>()
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+([\d.]+)([BKMG])\+?-?\s*$/.exec(line)
    if (m && pids.includes(Number(m[1]))) mb.set(Number(m[1]), Number(m[2]) * unit[m[3]!]!)
  }
  return mb
}

/** Memory per process type (MB): resident and physical footprint (`fp…`). */
async function memory(app: ElectronApplication) {
  const metrics = await app.evaluate(({ app: a }) =>
    a.getAppMetrics().map((m) => ({ type: m.type, pid: m.pid, kb: m.memory.workingSetSize })),
  )
  const out: Record<string, number> = {}
  for (const m of metrics) out[m.type] = (out[m.type] ?? 0) + m.kb
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]! / 1024)
  out.total = Math.round(metrics.reduce((s, m) => s + m.kb, 0) / 1024)
  const fp = footprintMb(metrics.map((m) => m.pid))
  for (const m of metrics)
    out[`fp${m.type}`] = Math.round((out[`fp${m.type}`] ?? 0) + (fp.get(m.pid) ?? 0))
  out.fpTotal = Math.round([...fp.values()].reduce((a, b) => a + b, 0))
  return out
}

/**
 * Compositor trace during `action()`: missing tiles drawn (`AppendQuads checkerboard`,
 * painted as flat fill) and tile-memory allocation failures (GPU budget exceeded).
 */
async function tileTrace(page: Page, action: () => Promise<void>) {
  const cdp = await page.context().newCDPSession(page)
  const events: { name: string; args?: Record<string, unknown> }[] = []
  cdp.on('Tracing.dataCollected', (d) => {
    events.push(...(d.value as unknown as typeof events))
  })
  await cdp.send('Tracing.start', {
    traceConfig: { includedCategories: ['cc', 'disabled-by-default-cc.debug'] },
  })
  try {
    await action()
  } finally {
    const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r))
    await cdp.send('Tracing.end')
    await done
    await cdp.detach().catch(() => undefined)
  }
  const assign = events.filter((e) => e.name === 'TileManager::AssignGpuMemoryToTiles')
  return {
    checkerboard: events.filter((e) => e.name === 'TileBasedLayerImpl::AppendQuads checkerboard')
      .length,
    oom: assign.filter((e) => e.args?.had_enough_memory_to_schedule_tiles_needed_now === false)
      .length,
    assign: assign.length,
  }
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Bare background of the detail view (`--viewer-base`, #0e0c0d) as rendered by the capture. */
const BASE = [14, 12, 13] as const

const nearBase = (d: Buffer, i: number, tol: number) =>
  (d[i]! <= 2 && d[i + 1]! <= 2 && d[i + 2]! <= 2) ||
  (Math.abs(d[i]! - BASE[0]) <= tol &&
    Math.abs(d[i + 1]! - BASE[1]) <= tol &&
    Math.abs(d[i + 2]! - BASE[2]) <= tol)

/**
 * Holes in a capture: 16 × 16 px CSS cells where only the bare background of the view remains
 * (`--viewer-base`, or pure black) while the stable end-of-step frame (`ref`) shows a colored
 * ambiance there (difference ≥ 10 on a channel). An unrasterized tile reveals this flat
 * background. Returns the number of holed cells outside `exclude` (media, panel).
 */
function holeCells(png: PNG, ref: PNG, scale: number, exclude: Rect[]): number {
  const cell = Math.round(16 * scale)
  let n = 0
  for (let cy = 0; cy + cell <= png.height; cy += cell) {
    for (let cx = 0; cx + cell <= png.width; cx += cell) {
      const css = { x: cx / scale, y: cy / scale, w: cell / scale }
      const hit = exclude.some(
        (r) =>
          css.x + css.w > r.x - 8 &&
          css.x < r.x + r.width + 8 &&
          css.y + css.w > r.y - 8 &&
          css.y < r.y + r.height + 8,
      )
      if (hit) continue
      // Colored ambiance expected here?
      const ci = ((cy + (cell >> 1)) * ref.width + cx + (cell >> 1)) * 4
      if (nearBase(ref.data, ci, 9)) continue
      let hole = true
      for (let y = cy; y < cy + cell && hole; y += 2) {
        for (let x = cx; x < cx + cell; x += 2) {
          if (!nearBase(png.data, (y * png.width + x) * 4, 2)) {
            hole = false
            break
          }
        }
      }
      if (hole) n++
    }
  }
  return n
}

/**
 * Frames presented by the compositor during `action()`, in ONE session (restarting the capture
 * at each step would force one extra frame). Each frame is labeled by `tag()` on arrival.
 */
async function screencast(page: Page, tag: () => number, action: () => Promise<void>) {
  const cdp = await page.context().newCDPSession(page)
  const frames: { tag: number; buf: Buffer }[] = []
  cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
    frames.push({ tag: tag(), buf: Buffer.from(f.data, 'base64') })
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined)
  })
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
  try {
    await action()
  } finally {
    await cdp.send('Page.stopScreencast').catch(() => undefined)
    await cdp.detach().catch(() => undefined)
  }
  return frames
}

interface Card {
  uuid: string
  kind: string
  dominant: string | null
}

const lum = (hex: string | null) => {
  if (!hex) return 0
  const n = Number.parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}

/**
 * Starting point in the library order (that of ←/→ navigation): an image followed, within the
 * next 3, by at least one video and another image, all with a non-black dominant color
 * (colored ambiance expected). Returns the starting uuid and the type of each item.
 */
async function pickStart(page: Page): Promise<{ uuid: string; kinds: Map<string, string> }> {
  await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
  const list = await page.evaluate(async () => {
    const r = (await (
      window as unknown as {
        recolt: { invoke: (c: string, i: unknown) => Promise<unknown> }
      }
    ).recolt.invoke('items.list', { scope: 'library', tab: 'all', limit: 200, cursor: null })) as {
      data: { items: { uuid: string; kind: string; dominant: string | null }[] }
    }
    return r.data.items.map(({ uuid, kind, dominant }) => ({ uuid, kind, dominant }))
  })
  const kinds = new Map(list.map((c) => [c.uuid, c.kind]))
  const mounted = new Set(
    await page
      .locator(`${t('grid')} ${t('card')}`)
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-uuid'))),
  )
  const media = (c: Card | undefined) =>
    !!c && (c.kind === 'image' || c.kind === 'video') && lum(c.dominant) > 0.005
  for (let i = 0; i + 3 < list.length; i++) {
    const win = list.slice(i, i + 4)
    if (
      list[i]!.kind === 'image' &&
      mounted.has(list[i]!.uuid) &&
      win.every(media) &&
      win.some((c) => c.kind === 'video') &&
      win.slice(1).some((c) => c.kind === 'image')
    )
      return { uuid: list[i]!.uuid, kinds }
  }
  // Fallback (demo): first media.
  return { uuid: (list.find((c) => media(c) && mounted.has(c.uuid)) ?? list[0]!).uuid, kinds }
}

const NAV = ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft', 'ArrowRight']
const STEP_MS = 900

async function openViewer(page: Page, uuid: string) {
  const card = page.locator(`${t('grid')} ${t('card')}[data-uuid="${uuid}"]`)
  await card.scrollIntoViewIfNeeded()
  await card.click()
  await expect(page.locator(t('detail'))).toBeVisible()
  await page.waitForTimeout(1200)
}

async function closeViewer(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.locator(t('detail'))).toHaveCount(0)
  await page.waitForTimeout(400)
}

test('V1: detail view, 6 smooth ←/→ navigations, ambient glow without black areas', async ({
  app,
  page,
}) => {
  test.setTimeout(150_000)
  await expect(page.locator(t('app-shell'))).toBeVisible()
  await page.waitForTimeout(2000)
  const { uuid: start, kinds: kindOf } = await pickStart(page)
  await enableMotion(page)
  const before = await memory(app)

  // Pass 1: smoothness (no capture during measurement).
  await openViewer(page, start)
  const kinds: string[] = []
  const stop = await startProbe(page)
  for (const key of NAV) {
    await page.keyboard.press(key)
    await page.waitForTimeout(STEP_MS)
    kinds.push(kindOf.get((await page.locator(t('detail')).getAttribute('data-uuid')) ?? '') ?? '?')
  }
  const probe = await stop()
  const during = await memory(app)
  await closeViewer(page)

  // Pass 2: compositor captures during the fades.
  await openViewer(page, start)
  const exclude = async () => {
    const boxes: Rect[] = []
    for (const id of ['viewer-media', 'details-panel', 'viewer-video']) {
      for (const b of await page.locator(t(id)).all()) {
        const r = await b.boundingBox()
        if (r) boxes.push(r)
      }
    }
    return boxes
  }
  const hull = (a: Rect, b: Rect): Rect => {
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    return {
      x,
      y,
      width: Math.max(a.x + a.width, b.x + b.width) - x,
      height: Math.max(a.y + a.height, b.y + b.height) - y,
    }
  }
  // Media and panel frames at each step boundary (the media animates from one to the other).
  const bounds: Rect[][] = [await exclude()]
  let step = -1
  let frames: { tag: number; buf: Buffer }[] = []
  const tiles = await tileTrace(page, async () => {
    frames = await screencast(
      page,
      () => step,
      async () => {
        await page.waitForTimeout(400)
        for (const key of NAV) {
          step++
          await page.keyboard.press(key)
          await page.waitForTimeout(STEP_MS)
          bounds.push(await exclude())
        }
      },
    )
  })
  const results = NAV.map((_, i) => ({ step: i, frames: 0, black: 0, worst: 0 }))
  // Stable reference frame: the last one of each step.
  const refs = new Map<number, PNG>()
  for (const { tag, buf } of frames) if (tag >= 0) refs.set(tag, PNG.sync.read(buf))
  for (const [j, { tag, buf }] of frames.entries()) {
    if (tag < 0) continue
    const a = bounds[tag]!
    const b = bounds[tag + 1] ?? a
    const ex = [...a, ...b, ...(a[0] && b[0] ? [hull(a[0], b[0])] : [])]
    const png = PNG.sync.read(buf)
    const n = holeCells(png, refs.get(tag)!, png.width / 1512, ex)
    const r = results[tag]!
    r.frames++
    if (n > 0) r.black++
    if (n > r.worst) {
      r.worst = n
      if (shots) {
        fs.mkdirSync(shots, { recursive: true })
        fs.writeFileSync(path.join(shots, `viewer-${label}-step${tag}-f${j}-n${n}.png`), buf)
      }
    }
    // One full-fade frame per step (3rd frame of the step), for visual comparison.
    if (shots && r.frames === 3) {
      fs.mkdirSync(shots, { recursive: true })
      fs.writeFileSync(path.join(shots, `viewer-${label}-step${tag}-mid.png`), buf)
    }
  }
  await closeViewer(page)

  const stats = frameStats(probe.frames)
  report.viewer = {
    start,
    kinds,
    ...stats,
    longtasks: probe.long.map(Math.round),
    screencast: results,
    tiles,
    memory: { before, during },
  }
  console.warn('V1', JSON.stringify(report.viewer))
  expect(kinds, 'images and videos browsed').toContain('video')
  expect(kinds, 'images and videos browsed').toContain('image')
  expect(stats.over50, `images > 50 ms (max ${stats.maxms} ms)`).toBe(0)
  expect(
    results.filter((r) => r.worst > 0),
    'black flats (missing tiles) in the ambient backdrop',
  ).toEqual([])
  expect(tiles.checkerboard, 'missing tiles drawn by the compositor').toBe(0)
  expect(tiles.oom, 'insufficient tile memory').toBe(0)
})

test('E1: shelf, cascading entry and hover over 5 slices smooth', async ({ app, page }) => {
  test.setTimeout(150_000)
  await expect(page.locator(t('app-shell'))).toBeVisible()
  await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
  await page.waitForTimeout(2000)
  await enableMotion(page)
  const before = await memory(app)

  const runs: Record<string, unknown>[] = []
  const all: number[] = []
  const long: number[] = []
  for (let pass = 0; pass < 3; pass++) {
    await page.mouse.move(5, 500)
    const stop = await startProbe(page)
    await page.locator(t('seg-collections')).click()
    await expect(page.locator(t('shelf-cover')).first()).toBeVisible()
    // Cascade: 18 × 45 ms offset + 560 ms fall.
    await page.waitForTimeout(1600)
    const entry = await stop()
    const covers = page.locator(t('shelf-cover'))
    const n = Math.min(5, await covers.count())
    const stopHover = await startProbe(page)
    for (let i = 0; i < n; i++) {
      const b = (await covers.nth(i).boundingBox())!
      await page.mouse.move(b.x + b.width / 2, b.y + 300, { steps: 6 })
      await page.waitForTimeout(420)
    }
    await page.mouse.move(5, 500, { steps: 4 })
    await page.waitForTimeout(300)
    const hover = await stopHover()
    if (shots && pass === 0) {
      fs.mkdirSync(shots, { recursive: true })
      await page.screenshot({ path: path.join(shots, `shelf-${label}.png`) })
    }
    runs.push({ entry: frameStats(entry.frames), hover: frameStats(hover.frames) })
    all.push(...entry.frames, ...hover.frames)
    long.push(...entry.long, ...hover.long)
    await page.locator(t('seg-library')).click()
    await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
    await page.waitForTimeout(600)
  }
  const during = await memory(app)
  // Control pass (outside smoothness measurement): no missing tile during entry and hover.
  const tiles = await tileTrace(page, async () => {
    await page.locator(t('seg-collections')).click()
    await expect(page.locator(t('shelf-cover')).first()).toBeVisible()
    await page.waitForTimeout(1600)
    const covers = page.locator(t('shelf-cover'))
    for (let i = 0; i < Math.min(5, await covers.count()); i++) {
      const b = (await covers.nth(i).boundingBox())!
      await page.mouse.move(b.x + b.width / 2, b.y + 300, { steps: 6 })
      await page.waitForTimeout(420)
    }
  })
  const stats = frameStats(all)
  report.shelf = {
    ...stats,
    runs,
    longtasks: long.map(Math.round),
    tiles,
    memory: { before, during },
  }
  console.warn('E1', JSON.stringify(report.shelf))
  expect(stats.p95ms, 'image p95 (ms)').toBeLessThanOrEqual(20)
  expect(long.map(Math.round), 'longtasks').toEqual([])
  expect(tiles.checkerboard, 'missing tiles drawn by the compositor').toBe(0)
})
