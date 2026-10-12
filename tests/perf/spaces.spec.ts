/**
 * Spaces measurements — Playwright `perf` project (outside `verify`).
 *   S1: 500 nodes (480 images, 20 videos of which ≤ 2 active), synthetic pan / zoom with the wheel
 *        for 2 × 2 s, frame durations (rAF), app memory, `will-change` removed at rest.
 *        memory per process type at each step (library, overview, 100 %,
 *        tour of 12 stops at 150 %, back to overview) and mounted image variants.
 *   S5: PNG export of a ~4,000 × 3,000 world at 2× (20 images, 1 post, 1 video, notes) through the
 *        stage window: duration, dimensions, reference pixel, seam between tiles.
 * Library: APFS copy of the real library if `RECOLTOS_S1_USERDATA` is set (e.g.
 * `.tmp/m6-s1`, clone of `.tmp/m3-real`), otherwise demo library. Report: `.tmp/m6-perf.json`.
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'
import type { Page } from '@playwright/test'
import { expect, test } from '../helpers/e2e-fixtures'
import { REPO_ROOT } from '../helpers/paths'

const t = (id: string) => `[data-testid="${id}"]`
const userData = process.env.RECOLTOS_S1_USERDATA
const report: Record<string, unknown> = {}

const invoke = <T = unknown>(page: Page, channel: string, input?: unknown) =>
  page.evaluate(
    ([c, i]) =>
      (
        window as unknown as { recolt: { invoke: (c: string, i: unknown) => Promise<unknown> } }
      ).recolt.invoke(c, i),
    [channel, input] as const,
  ) as Promise<{ ok: boolean; data: T; error?: { message: string } }>

interface Card {
  uuid: string
  kind: string
  width: number | null
  height: number | null
  mediaCount: number
  previewUrl: string | null
}

async function pickItems(page: Page, images: number, videos: number) {
  const all: Card[] = []
  let cursor: string | null = null
  for (let i = 0; i < 10; i++) {
    const r: { data: { items: Card[]; nextCursor: string | null } } = await invoke<{
      items: Card[]
      nextCursor: string | null
    }>(page, 'items.list', {
      scope: 'library',
      tab: 'all',
      limit: 500,
      cursor,
    })
    all.push(...r.data.items)
    cursor = r.data.nextCursor
    if (!cursor) break
  }
  const imgs = all.filter((c) => c.kind === 'image')
  const vids = all.filter((c) => c.kind === 'video')
  const take = (l: Card[], n: number) =>
    Array.from({ length: n }, (_, i) => l[i % Math.max(1, l.length)]!)
  return {
    imgs: take(imgs, images),
    vids: take(vids.length ? vids : imgs, videos),
    total: all.length,
  }
}

function itemNode(c: Card, i: number, x: number, y: number) {
  const w = c.width && c.height ? 320 : 320
  const h = c.width && c.height ? Math.max(24, Math.round((320 * c.height) / c.width)) : 320
  const now = Date.now()
  return {
    uuid: randomUUID(),
    type: 'item',
    itemUuid: c.uuid,
    x,
    y,
    width: w,
    height: Math.min(h, 640),
    rotation: 0,
    z: i,
    locked: false,
    createdAt: now,
    updatedAt: now,
    style: { fit: 'cover', radius: 8, border: false, lockAspect: true },
  }
}

/** Physical footprint (MB) of each process, read by `top` (MEM column). */
function footprintMb(pids: number[]): Map<number, number> {
  const out = execFileSync(
    'top',
    ['-l', '1', '-stats', 'pid,mem', ...pids.flatMap((p) => ['-pid', String(p)])],
    {
      encoding: 'utf8',
    },
  )
  const unit: Record<string, number> = { B: 1 / 2 ** 20, K: 1 / 1024, M: 1, G: 1024 }
  const mb = new Map<number, number>()
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+([\d.]+)([BKMG])\+?-?\s*$/.exec(line)
    if (m && pids.includes(Number(m[1]))) mb.set(Number(m[1]), Number(m[2]) * unit[m[3]!]!)
  }
  return mb
}

test.describe.configure({ mode: 'serial' })
const dsf = process.env.RECOLTOS_S1_DSF === '2' ? 2 : 1
test.use(
  userData
    ? {
        appLaunch: {
          userData,
          windowSize: '1512x945',
          deviceScaleFactor: dsf,
          // Chromium switches to try (measurement only), separated by spaces.
          args: process.env.RECOLTOS_S1_ARGS?.split(' ').filter(Boolean),
        },
      }
    : {
        demoLibrary: { count: 60, collections: 2 },
        appLaunch: { windowSize: '1512x945', deviceScaleFactor: dsf },
      },
)

test.afterAll(() => {
  fs.mkdirSync(path.join(REPO_ROOT, '.tmp'), { recursive: true })
  fs.writeFileSync(path.join(REPO_ROOT, '.tmp/m6-perf.json'), JSON.stringify(report, null, 2))
})

test('S1: 500 nodes, pan / zoom, memory', async ({ app, page }) => {
  test.setTimeout(240_000)
  await expect(page.locator(t('app-shell'))).toBeVisible()
  // Memory per process type (MB): `workingSetSize` (resident, counts shared code in each
  // process; reference metric) and physical footprint (`top`, the « Mémoire » column of
  // Activity Monitor, more stable), JS heap and mounted image variants.
  const memory = async () => {
    const metrics = await app.evaluate(({ app: a }) =>
      a.getAppMetrics().map((m) => ({ type: m.type, pid: m.pid, kb: m.memory.workingSetSize })),
    )
    const out: Record<string, number> = { processes: metrics.length }
    for (const m of metrics) out[m.type] = (out[m.type] ?? 0) + m.kb
    for (const k of Object.keys(out)) if (k !== 'processes') out[k] = Math.round(out[k]! / 1024)
    out.total = Math.round(metrics.reduce((s, m) => s + m.kb, 0) / 1024)
    const fp = footprintMb(metrics.map((m) => m.pid))
    out.footprint = Math.round([...fp.values()].reduce((a, b) => a + b, 0))
    for (const m of metrics)
      out[`fp${m.type}`] = Math.round((out[`fp${m.type}`] ?? 0) + (fp.get(m.pid) ?? 0))
    const mainHeap = await app.evaluate(() => process.memoryUsage().heapUsed)
    out.mainHeap = Math.round(mainHeap / 2 ** 20)
    out.rendererHeap = await page.evaluate(() =>
      Math.round(
        (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize /
          2 ** 20,
      ),
    )
    return out
  }
  const images = () =>
    page.evaluate(() => {
      const imgs = [
        ...document.querySelectorAll<HTMLImageElement>('[data-testid="space-world"] img'),
      ]
      const src = (i: HTMLImageElement) => i.currentSrc || i.getAttribute('src') || ''
      return {
        mounted: imgs.length,
        thumbs: imgs.filter((i) => src(i).includes('/thumbs/')).length,
        large: imgs.filter((i) => src(i).includes('/large/')).length,
        other: imgs.filter((i) => src(i) && !/\/(thumbs|large)\//.test(src(i))).length,
        videos: document.querySelectorAll('[data-testid="space-world"] video').length,
      }
    })
  // Library (grid) before opening the canvas: the app baseline.
  await page.waitForTimeout(3000)
  const libraryIdle = { memory: await memory() }
  const { imgs, vids, total } = await pickItems(page, 480, 20)
  report.library = {
    items: total,
    images: imgs.length,
    videos: vids.length,
    real: Boolean(userData),
  }
  const space = (await invoke<{ uuid: string }>(page, 'spaces.create', { name: 'S1 — 500 nœuds' }))
    .data.uuid
  const nodes = [...imgs, ...vids].map((c, i) =>
    itemNode(c, i, (i % 25) * 360, Math.floor(i / 25) * 680),
  )
  const r = await invoke(page, 'spaces.applyBatch', { spaceUuid: space, upsert: nodes, delete: [] })
  expect(r.ok, r.error?.message).toBe(true)
  await page.locator(t('seg-spaces')).click()
  await page.locator(`${t('space-card')}[data-uuid="${space}"]`).click()
  await expect(page.locator(t('space-viewport'))).toBeVisible()
  await page.waitForTimeout(1500)

  const run = (mode: 'pan' | 'zoom', ms: number) =>
    page.evaluate(
      ([m, dur]) =>
        new Promise<number[]>((resolve) => {
          const vp = document.querySelector('[data-testid="space-viewport"]')!
          const r = vp.getBoundingClientRect()
          const frames: number[] = []
          let last = performance.now()
          const t0 = last
          let k = 0
          const tick = (now: number) => {
            frames.push(now - last)
            last = now
            k++
            const dir = Math.floor(k / 60) % 2 === 0 ? 1 : -1
            vp.dispatchEvent(
              new WheelEvent('wheel', {
                deltaX: m === 'pan' ? 6 * dir : 0,
                deltaY: m === 'pan' ? 9 * dir : 4 * dir,
                ctrlKey: m === 'zoom',
                clientX: r.left + r.width / 2,
                clientY: r.top + r.height / 2,
                bubbles: true,
                cancelable: true,
              }),
            )
            if (now - t0 < dur) requestAnimationFrame(tick)
            else resolve(frames.slice(5))
          }
          requestAnimationFrame(tick)
        }),
      [mode, ms] as const,
    )
  const stats = (f: number[]) => {
    const s = [...f].sort((a, b) => a - b)
    const avg = f.reduce((a, b) => a + b, 0) / f.length
    return {
      frames: f.length,
      fps: Math.round((1000 / avg) * 10) / 10,
      p95ms: Math.round(s[Math.floor(s.length * 0.95)]! * 10) / 10,
      maxms: Math.round(s[s.length - 1]! * 10) / 10,
    }
  }
  // Overview (all images visible), then 100 %.
  await page.keyboard.press('Shift+Digit1')
  await page.waitForTimeout(3000)
  const overviewIdle = { memory: await memory(), images: await images() }
  const overview = { pan: stats(await run('pan', 2000)), zoom: stats(await run('zoom', 2000)) }
  await page.keyboard.press('Meta+Digit0')
  await page.waitForTimeout(1200)
  const z100 = { pan: stats(await run('pan', 2000)), zoom: stats(await run('zoom', 2000)) }
  await page.waitForTimeout(3000)
  const z100Idle = { memory: await memory(), images: await images() }
  // Tour: 12 stops at 150 % spread across the canvas, then back to the overview
  // (accumulation of decoded images or images kept off-screen).
  for (let k = 0; k < 12; k++) {
    await page.evaluate((i) => {
      const cam = (
        window as unknown as {
          __recoltSpaces: {
            useCamera: {
              setState(p: unknown): void
              getState(): { view: { w: number; h: number } }
            }
          }
        }
      ).__recoltSpaces.useCamera
      const { view } = cam.getState()
      const wx = ((i % 4) + 0.5) * (9000 / 4)
      const wy = (Math.floor(i / 4) + 0.5) * (13600 / 3)
      const zoom = 1.5
      cam.setState({ camera: { zoom, x: view.w / 2 - wx * zoom, y: view.h / 2 - wy * zoom } })
    }, k)
    await page.waitForTimeout(900)
  }
  const tourIdle = { memory: await memory(), images: await images() }
  await page.keyboard.press('Shift+Digit1')
  await page.waitForTimeout(3000)
  const afterTour = { memory: await memory(), images: await images() }
  const idle = await page.evaluate(() => ({
    moving: document.querySelector('[data-testid="space-world"]')!.classList.contains('is-moving'),
    mounted: document.querySelectorAll('[data-testid="space-world"] .space-node').length,
    videos: document.querySelectorAll('[data-testid="space-world"] video').length,
    zoom: (
      window as unknown as {
        __recoltSpaces: { useCamera: { getState(): { camera: { zoom: number } } } }
      }
    ).__recoltSpaces.useCamera.getState().camera.zoom,
  }))
  const metrics = await app.evaluate(({ app: a }) =>
    a.getAppMetrics().map((m) => ({ type: m.type, kb: m.memory.workingSetSize })),
  )
  const totalMb = Math.round(metrics.reduce((s, m) => s + m.kb, 0) / 1024)
  const rendererMb = Math.round(
    metrics.filter((m) => m.type === 'Tab').reduce((s, m) => s + m.kb, 0) / 1024,
  )
  report.s1 = {
    dsf,
    nodes: nodes.length,
    overview,
    zoom100: z100,
    idle,
    memory: { totalMb, rendererMb },
    libraryIdle,
    overviewIdle,
    z100Idle,
    tourIdle,
    afterTour,
  }
  console.warn('S1', JSON.stringify(report.s1))
  expect(idle.moving).toBe(false)
  expect(idle.videos).toBeLessThanOrEqual(2)
})

test('S5: PNG export 4,000 × 3,000 at 2×, seamless tiles', async ({ app, page }) => {
  test.setTimeout(240_000)
  await expect(page.locator(t('app-shell'))).toBeVisible()
  const { imgs, vids } = await pickItems(page, 20, 1)
  const tweets = (
    await invoke<{ items: Card[] }>(page, 'items.list', {
      scope: 'library',
      tab: 'all',
      limit: 500,
      filters: { kinds: ['tweet'] },
    })
  ).data.items.slice(0, 1)
  const space = (await invoke<{ uuid: string }>(page, 'spaces.create', { name: 'S5' })).data.uuid
  const now = Date.now()
  const nodes: Record<string, unknown>[] = [...imgs, ...vids, ...tweets].map((c, i) =>
    itemNode(c, 1000 + i, (i % 6) * 640 + 40, Math.floor(i / 6) * 700 + 40),
  )
  // Yellow note straddling the vertical border of the first two tiles (seam).
  nodes.push({
    uuid: randomUUID(),
    type: 'note',
    x: 1180,
    y: 2600,
    width: 600,
    height: 300,
    rotation: 0,
    z: 5000,
    locked: false,
    createdAt: now,
    updatedAt: now,
    content: '',
    style: { color: 'yellow', fontSize: 14, align: 'left' },
  })
  nodes.push({
    ...nodes[nodes.length - 1]!,
    uuid: randomUUID(),
    x: 3700,
    y: 2800,
    width: 300,
    height: 200,
  })
  await invoke(page, 'spaces.applyBatch', { spaceUuid: space, upsert: nodes, delete: [] })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recolt-s5-'))
  const out = path.join(dir, 's5.png')
  await app.evaluate(({ dialog }, file) => {
    ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = () =>
      Promise.resolve({ canceled: false, filePath: file })
  }, out)
  const t0 = Date.now()
  const r = await invoke<{ path: string }>(page, 'spaces.exportPng', {
    uuid: space,
    scope: 'all',
    scale: 2,
    background: 'light',
    name: 'S5',
  })
  const ms = Date.now() - t0
  expect(r.ok, r.error?.message).toBe(true)
  const buf = fs.readFileSync(out)
  const png = PNG.sync.read(buf)
  // Reference pixel: inside of the yellow note (#fff4b8).
  const s = png.width / (4000 + 96)
  const px = (x: number, y: number) => {
    const o = (Math.round(y) * png.width + Math.round(x)) * 4
    return [png.data[o]!, png.data[o + 1]!, png.data[o + 2]!]
  }
  const noteY = (2750 + 48) * s
  const ref = px((1300 + 48) * s, noteY)
  // Seam: column 2,560 is a tile border (1,280 CSS px × 1 or 2 depending on the capture).
  const seam = [px(2559, noteY), px(2560, noteY), px(2561, noteY)]
  report.s5 = {
    ms,
    width: png.width,
    height: png.height,
    scale: Math.round(s * 1000) / 1000,
    reference: ref,
    seam,
    bytes: buf.length,
  }
  fs.copyFileSync(out, path.join(REPO_ROOT, '.tmp/m6-shots/export-s5.png'))
  fs.rmSync(dir, { recursive: true, force: true })
  console.warn('S5', JSON.stringify(report.s5))
  expect(buf.subarray(0, 4).toString('hex')).toBe('89504e47')
  expect(ref).toEqual([0xff, 0xf4, 0xb8])
  for (const c of seam) expect(c).toEqual([0xff, 0xf4, 0xb8])
})
