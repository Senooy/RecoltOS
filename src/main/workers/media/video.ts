/**
 * Dérivés vidéo par ffmpeg système (PLAN §1.6, §1.16) :
 * - `posters/` jpg, largeur ≤ 1280 (ARCHI §5.2 étape 9) ;
 * - `previews/` mp4 540p, ≤ 8 s, muet, `h264_videotoolbox` avec repli libx264, `+faststart`.
 */
import { stat } from 'node:fs/promises'
import sharp from 'sharp'
import { AppError } from '../../../shared/errors'
import type { MediaResult } from '../../../shared/worker-protocol'
import { assertAbs, assertFile, requireTool, run, writeAtomic, type MediaTools } from './exec'
import { probeVideo } from './probe'

export const POSTER_MAX_WIDTH = 1280
export const PREVIEW = { maxSeconds: 8, height: 540, bitrate: '1500k', maxFps: 30 } as const

async function nonEmpty(p: string): Promise<boolean> {
  try {
    return (await stat(p)).size > 0
  } catch {
    return false
  }
}

export function posterArgs(src: string, out: string, atMs: number): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    (Math.max(0, atMs) / 1000).toFixed(3),
    '-i',
    src,
    '-frames:v',
    '1',
    '-an',
    '-vf',
    `scale='min(${POSTER_MAX_WIDTH},iw)':-2`,
    '-q:v',
    '3',
    out,
  ]
}

export async function makePoster(
  a: { src: string; dst: string; atMs: number },
  tools: MediaTools,
  signal?: AbortSignal,
): Promise<MediaResult<'makePoster'>> {
  const src = assertAbs(a.src, 'src')
  const dst = assertAbs(a.dst, 'dst')
  if (!Number.isFinite(a.atMs)) throw new AppError('validation', 'atMs invalide')
  const ffmpeg = requireTool(tools, 'ffmpeg')
  await assertFile(src)
  return writeAtomic(
    dst,
    async (tmp) => {
      let firstErr: unknown = null
      try {
        await run(ffmpeg, posterArgs(src, tmp, a.atMs), {
          tool: 'ffmpeg',
          timeoutMs: 60_000,
          signal,
        })
      } catch (err) {
        if (!(err instanceof AppError && err.code === 'tool_failed') || a.atMs <= 0) throw err
        firstErr = err
      }
      // Au-delà de la fin (vidéo plus courte que prévu), ffmpeg n'écrit rien : repli à 0.
      if ((firstErr || !(await nonEmpty(tmp))) && a.atMs > 0) {
        await run(ffmpeg, posterArgs(src, tmp, 0), { tool: 'ffmpeg', timeoutMs: 60_000, signal })
      }
      if (!(await nonEmpty(tmp))) throw new AppError('decode_failed', 'aucune image extraite')
      const meta = await sharp(tmp).metadata()
      return { width: meta.width, height: meta.height }
    },
    '.jpg',
  )
}

export type PreviewEncoder = 'h264_videotoolbox' | 'libx264'

export function previewArgs(src: string, out: string, encoder: PreviewEncoder): string[] {
  // « 540p » = petit côté ≤ 540, sans agrandir : paysage → hauteur 540 (960×540), portrait →
  // largeur 540 (540×960), pour que l'aperçu d'une vidéo verticale reste net face à son poster.
  // Dimensions paires (yuv420p) ; l'autre côté suit le ratio (-2). ffmpeg a déjà appliqué la
  // rotation d'affichage : iw/ih sont les dimensions vues par l'utilisateur.
  const h = PREVIEW.height
  const vf = [
    `scale='if(gte(iw,ih),-2,trunc(min(${h},iw)/2)*2)':'if(gte(iw,ih),trunc(min(${h},ih)/2)*2,-2)':flags=bicubic`,
    'format=yuv420p',
  ].join(',')
  const extras: Record<PreviewEncoder, string[]> = {
    h264_videotoolbox: ['-b:v', PREVIEW.bitrate, '-profile:v', 'main', '-allow_sw', '1'],
    libx264: ['-preset', 'veryfast', '-crf', '26', '-profile:v', 'main'],
  }
  // L'encodeur est passé tel quel : un encodeur indisponible fait échouer ffmpeg (repli).
  const codec = ['-c:v', encoder, ...(Object.hasOwn(extras, encoder) ? extras[encoder] : [])]
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    src,
    '-map',
    '0:v:0',
    '-t',
    String(PREVIEW.maxSeconds),
    '-an',
    '-sn',
    '-dn',
    '-map_metadata',
    '-1',
    '-vf',
    vf,
    '-fpsmax',
    String(PREVIEW.maxFps),
    ...codec,
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    out,
  ]
}

export async function makePreview(
  a: { src: string; dst: string; maxSeconds: 8; height: 540 },
  tools: MediaTools,
  signal?: AbortSignal,
  encoders: readonly PreviewEncoder[] = ['h264_videotoolbox', 'libx264'],
): Promise<MediaResult<'makePreview'>> {
  const src = assertAbs(a.src, 'src')
  const dst = assertAbs(a.dst, 'dst')
  if (a.maxSeconds !== PREVIEW.maxSeconds || a.height !== PREVIEW.height) {
    throw new AppError('validation', 'aperçu attendu : 8 s, 540p')
  }
  const ffmpeg = requireTool(tools, 'ffmpeg')
  requireTool(tools, 'ffprobe')
  await assertFile(src)
  return writeAtomic(
    dst,
    async (tmp) => {
      let lastErr: unknown = null
      for (const enc of encoders) {
        try {
          await run(ffmpeg, previewArgs(src, tmp, enc), {
            tool: 'ffmpeg',
            timeoutMs: 300_000,
            signal,
          })
          if (await nonEmpty(tmp)) {
            lastErr = null
            break
          }
          lastErr = new AppError('tool_failed', `${enc} n'a rien produit`)
        } catch (err) {
          // Binaire absent ou annulation : inutile d'essayer l'encodeur suivant.
          if (err instanceof AppError && err.code !== 'tool_failed') throw err
          lastErr = err
        }
      }
      if (lastErr) throw lastErr instanceof Error ? lastErr : new Error('encodage impossible')
      const p = await probeVideo({ abs: tmp }, tools, signal)
      const bytes = (await stat(tmp)).size
      return { width: p.width, height: p.height, durationMs: p.durationMs, bytes }
    },
    '.mp4',
  )
}
