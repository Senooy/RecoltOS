/**
 * Fluidité de la vue détail et de l'étagère — projet Playwright `perf` (hors `verify`).
 *   V1 : vue détail, ouverture puis 6 navigations ←/→ sur images et vidéos. Passe 1 : sonde rAF et
 *        `longtask` (sans capture) : aucune image > 50 ms hors première ouverture. Passe 2 : captures
 *        du compositeur (`Page.startScreencast`) pendant les fondus d'ambiance, échantillonnées : aucun
 *        aplat sombre (fond nu ou noir, tuile non rastérisée) là où l'image stable montre une ambiance
 *        colorée, hors média et panneau ; et, par trace `cc`, aucune tuile absente dessinée ni
 *        mémoire de tuiles insuffisante.
 *   E1 : étagère des collections, 3 entrées en cascade + survol de 5 tranches : p95 ≤ 20 ms, aucune
 *        `longtask` ; passe de contrôle tracée : aucune tuile absente dessinée.
 * Animations RÉELLES : l'attribut `data-e2e` (qui les coupe) est retiré avant d'ouvrir les vues.
 * Bibliothèque : `RECOLTOS_PERF_USERDATA` (clone APFS de la bibliothèque réelle), sinon démo.
 * Densité : 2 (Retina) par défaut, `RECOLTOS_PERF_DSF=1` sinon. Captures (si
 * `RECOLTOS_PERF_SHOTS=dossier` : pire image trouée et une image en plein fondu par pas) et rapport :
 * `.tmp/m8-perf-gfx.json` (clé `RECOLTOS_PERF_LABEL`, mémoire résidente et empreinte par processus).
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

/** Animations réelles : sans `data-e2e`, les vues lisent le mouvement au montage. */
async function enableMotion(page: Page) {
  await page.evaluate(() => {
    delete document.documentElement.dataset.e2e
  })
}

/** Sonde rAF + `longtask` : démarre maintenant, `stop()` renvoie les durées d'images. */
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

/** Mémoire par type de processus (Mo, résident). */
/** Empreinte physique (Mo) de chaque processus, lue par `top` (colonne MEM, textures GPU comprises). */
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

/** Mémoire par type de processus (Mo) : résidente et empreinte physique (`fp…`). */
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
 * Trace du compositeur pendant `action()` : tuiles absentes dessinées (`AppendQuads checkerboard`,
 * peintes en aplat) et attributions de mémoire de tuiles en échec (budget GPU dépassé).
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

/** Fond nu de la vue détail (`--viewer-base`, #0e0c0d) tel que le restitue la capture. */
const BASE = [14, 12, 13] as const

const nearBase = (d: Buffer, i: number, tol: number) =>
  (d[i]! <= 2 && d[i + 1]! <= 2 && d[i + 2]! <= 2) ||
  (Math.abs(d[i]! - BASE[0]) <= tol &&
    Math.abs(d[i + 1]! - BASE[1]) <= tol &&
    Math.abs(d[i + 2]! - BASE[2]) <= tol)

/**
 * Trous d'une capture : cellules de 16 × 16 px CSS où ne reste que le fond nu de la vue
 * (`--viewer-base`, ou noir pur) alors que l'image stable de fin de pas (`ref`) y montre une ambiance
 * colorée (écart ≥ 10 sur un canal). Une tuile non rastérisée laisse voir ce fond plat. Renvoie le
 * nombre de cellules trouées hors `exclude` (média, panneau).
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
      // Ambiance colorée attendue ici ?
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
 * Captures présentées par le compositeur pendant `action()`, en UNE session (relancer la capture
 * à chaque pas forcerait une image de plus). Chaque image est étiquetée par `tag()` à son arrivée.
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
 * Point de départ dans l'ordre de la bibliothèque (celui de la navigation ←/→) : une image suivie,
 * dans les 3 suivants, d'au moins une vidéo et d'une autre image, toutes de couleur dominante non
 * noire (ambiance colorée attendue). Renvoie l'uuid de départ et le type de chaque élément.
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
  // Repli (démo) : premier média.
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

test('V1 : vue détail, 6 navigations ←/→ fluides, ambiance sans aplat noir', async ({
  app,
  page,
}) => {
  test.setTimeout(150_000)
  await expect(page.locator(t('app-shell'))).toBeVisible()
  await page.waitForTimeout(2000)
  const { uuid: start, kinds: kindOf } = await pickStart(page)
  await enableMotion(page)
  const before = await memory(app)

  // Passe 1 : fluidité (aucune capture pendant la mesure).
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

  // Passe 2 : captures du compositeur pendant les fondus.
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
  // Cadres du média et du panneau à chaque frontière de pas (le média s'anime de l'un à l'autre).
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
  // Image stable de référence : la dernière de chaque pas.
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
    // Une image en plein fondu par pas (3e image du pas), pour comparer à l'œil.
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
  expect(kinds, 'images et vidéos parcourues').toContain('video')
  expect(kinds, 'images et vidéos parcourues').toContain('image')
  expect(stats.over50, `images > 50 ms (max ${stats.maxms} ms)`).toBe(0)
  expect(
    results.filter((r) => r.worst > 0),
    'aplats noirs (tuiles manquantes) dans l’ambiance',
  ).toEqual([])
  expect(tiles.checkerboard, 'tuiles absentes dessinées par le compositeur').toBe(0)
  expect(tiles.oom, 'mémoire de tuiles insuffisante').toBe(0)
})

test('E1 : étagère, entrée en cascade et survol de 5 tranches fluides', async ({ app, page }) => {
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
    // Cascade : 18 × 45 ms de décalage + 560 ms de chute.
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
  // Passe de contrôle (hors mesure de fluidité) : aucune tuile absente pendant entrée et survol.
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
  expect(stats.p95ms, 'p95 des images (ms)').toBeLessThanOrEqual(20)
  expect(long.map(Math.round), 'longtasks').toEqual([])
  expect(tiles.checkerboard, 'tuiles absentes dessinées par le compositeur').toBe(0)
})
