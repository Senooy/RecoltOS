/**
 * Rendu d'un space par la fenêtre « stage ».
 * Fenêtre hors écran (`withOffscreenWindow` : partition non persistante, sandbox, sans preload) qui
 * charge `offscreen.html?render=space-stage` ; le main y pousse le document puis place la caméra
 * tuile par tuile (multiples entiers de la tuile : même phase sous-pixel, pas de couture) et assemble
 * les `capturePage` dans un tampon BGRA, encodé en PNG sans dépendance (`nativeImage`).
 */
import { nativeImage, type BrowserWindow } from 'electron'
import type { SpaceDoc } from '../../shared/dto/spaces'
import { AppError } from '../../shared/errors'
import { aabb, unionRect } from '../../shared/spaces-geometry'
import { offscreenUrl, withOffscreenWindow } from '../windows/offscreen'
import { placeTile, planExport, type ExportPlan } from './tiles'

export type StageMode = 'hidden' | 'offscreen' | 'visible'
/** Mode retenu après mesure (fenêtre hors écran). */
export const STAGE_MODE: StageMode = 'offscreen'
/** Mesures seulement : `RECOLTOS_STAGE_MODE=hidden` sous `RECOLTOS_E2E=1`. */
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
  /** Plan effectif (échelle éventuellement réduite), pour l'UI et les tests. */
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
  throw new AppError('timeout', 'fenêtre stage : chargement trop long')
}

/** PNG d'un space (tout ou sélection) à l'échelle demandée (bornée à 8 192 px / 40 Mpx). */
export async function renderSpacePng(
  doc: SpaceDoc,
  job: PngJob,
  hooks: StageHooks = {},
): Promise<Buffer> {
  const ids = job.scope === 'selection' && job.ids ? new Set(job.ids) : null
  const nodes = ids ? doc.nodes.filter((n) => ids.has(n.uuid)) : doc.nodes
  const box = unionRect(nodes.map(aabb))
  if (!box) throw new AppError('validation', 'Rien à exporter : le space est vide.')
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
      // Échelle réelle de la capture (1 en rendu hors écran, 2 sur Retina en fenêtre cachée).
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
      // JSON = littéral JS valide : aucune interpolation de texte utilisateur hors JSON.
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
