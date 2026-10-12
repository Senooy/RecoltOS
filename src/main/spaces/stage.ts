/**
 * Rendering a space through the « stage » window.
 * Off-screen window (`withOffscreenWindow`: non-persistent partition, sandbox, no preload) that
 * loads `offscreen.html?render=space-stage`; main pushes the document there, then places the camera
 * tile by tile (whole multiples of the tile: same sub-pixel phase, no seam) and assembles
 * the `capturePage` results into a BGRA buffer, encoded as PNG without dependency (`nativeImage`).
 */
import { nativeImage, type BrowserWindow } from 'electron'
import type { SpaceDoc } from '../../shared/dto/spaces'
import { AppError } from '../../shared/errors'
import { aabb, unionRect } from '../../shared/spaces-geometry'
import { offscreenUrl, withOffscreenWindow } from '../windows/offscreen'
import { placeTile, planExport, type ExportPlan } from './tiles'
import { mt } from '../i18n'

export type StageMode = 'hidden' | 'offscreen' | 'visible'
/** Mode selected after measurement (off-screen window). */
export const STAGE_MODE: StageMode = 'offscreen'
/** Measurements only: `RECOLTOS_STAGE_MODE=hidden` under `RECOLTOS_E2E=1`. */
const stageMode = (): StageMode =>
  process.env.RECOLTOS_E2E === '1' && process.env.RECOLTOS_STAGE_MODE === 'hidden'
    ? 'hidden'
    : STAGE_MODE
export const STAGE_TILE = { w: 1280, h: 800 } as const
const STAGE_TIMEOUT_MS = 10 * 60_000

export interface PngJob {
  scope: 'all' | 'selection'
  ids?: readonly string[]
  scale: 1 | 2 | 3
  theme: 'light' | 'dark'
}

export interface StageHooks {
  onProgress?(done: number, total: number): void
  signal?: AbortSignal
  /** Effective plan (scale possibly reduced), for the UI and the tests. */
  onPlan?(plan: ExportPlan): void
}

async function waitStage(win: BrowserWindow): Promise<void> {
  for (let i = 0; i < 800; i++) {
    const ok = (await win.webContents.executeJavaScript(
      'Boolean(window.__stage) && document.documentElement.dataset.stageReady === "1"',
    )) as boolean
    if (ok) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new AppError('timeout', 'stage window: load timed out')
}

/** PNG of a space (all or a selection) at the requested scale (capped at 8,192 px / 40 Mpx). */
export async function renderSpacePng(
  doc: SpaceDoc,
  job: PngJob,
  hooks: StageHooks = {},
): Promise<Buffer> {
  const ids = job.scope === 'selection' && job.ids ? new Set(job.ids) : null
  const nodes = ids ? doc.nodes.filter((n) => ids.has(n.uuid)) : doc.nodes
  const box = unionRect(nodes.map(aabb))
  if (!box) throw new AppError('validation', mt().errors.spaceEmptyExport)
  return withOffscreenWindow(
    {
      width: STAGE_TILE.w,
      height: STAGE_TILE.h,
      offscreen: stageMode() === 'offscreen',
      timeoutMs: STAGE_TIMEOUT_MS,
    },
    async (win) => {
      await win.loadURL(offscreenUrl('space-stage', { theme: job.theme }))
      await waitStage(win)
      // Actual capture scale (1 for off-screen rendering, 2 on Retina in a hidden window).
      const probe = await win.webContents.capturePage()
      const sf = Math.max(1, ...probe.getScaleFactors())
      const plan = planExport(box, job.scale, sf, STAGE_TILE)
      hooks.onPlan?.(plan)
      const spec = {
        nodes,
        items: doc.items,
        theme: job.theme,
        outScale: plan.scale,
        tile: STAGE_TILE,
      }
      // JSON = valid JS literal: no interpolation of user text outside the JSON.
      await win.webContents.executeJavaScript(`window.__stage.load(${JSON.stringify(spec)})`)
      const out = Buffer.alloc(plan.width * plan.height * 4)
      let done = 0
      for (const tile of plan.tiles) {
        hooks.signal?.throwIfAborted()
        await win.webContents.executeJavaScript(
          `window.__stage.show(${JSON.stringify(tile.camera)})`,
        )
        const img = await win.webContents.capturePage({
          x: 0,
          y: 0,
          width: STAGE_TILE.w,
          height: STAGE_TILE.h,
        })
        const size = img.getSize(sf)
        if (size.width !== plan.tilePx.w || size.height !== plan.tilePx.h) {
          throw new AppError('io', 'STAGE_SIZE_MISMATCH')
        }
        placeTile(out, plan.width, plan.height, img.toBitmap({ scaleFactor: sf }), size.width, tile)
        hooks.onProgress?.(++done, plan.tiles.length)
      }
      return nativeImage.createFromBitmap(out, { width: plan.width, height: plan.height }).toPNG()
    },
  )
}
