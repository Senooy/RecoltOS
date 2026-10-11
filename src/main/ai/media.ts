/**
 * Préparation des médias pour l'IA (AI §4). Les opérations lourdes passent par le media-worker
 * (`aiImage`, `extractFrame`, `probeVideo`) ; ce module décide QUOI envoyer :
 * - image / url : 1 JPEG ≤ 1568 px sans EXIF ;
 * - carrousel : couverture + médiane + dernière (diapositives vidéo ignorées) ;
 * - vidéo : 3 images clés à 10 / 50 / 90 % (cache `cache/frames/<uuid>/f1..f3.jpg`), chaque
 *   extraction vérifiée (fichier non vide), repli à 0,80·d puis `-sseof -0.5`, sinon abandon de
 *   cette image ; repli final : poster / miniature (1 image).
 */
import { existsSync, statSync } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AiMedia } from '../../shared/ai-types'
import type { MediaCaller } from '../jobs/handlers/types'

export const AI_IMAGE_MAX_EDGE = 1568
export const AI_FRAME_MAX_EDGE = 1024

export interface Slide {
  /** 0 = couverture. */
  index: number
  path: string
  type: 'image' | 'video'
}

/** Couverture + diapositives réparties (médiane, dernière) ; ignore les vidéos. */
export function pickSlides(slides: readonly Slide[], n = 3): Slide[] {
  const images = slides.filter((s) => s.type === 'image')
  if (images.length <= n) return images.slice(0, n)
  const last = images.length - 1
  const picks = n === 1 ? [0] : n === 2 ? [0, last] : [0, Math.round(last / 2), last]
  return [...new Set(picks)].map((i) => images[i]!)
}

/** Instants des images clés (AI §4) : 10/50/90 % ; < 1,5 s : [0, d/2] ; plafonné à d − 0,3 s. */
export function keyframeTimes(durationSec: number): number[] {
  const d = Math.max(0, durationSec)
  const raw = d < 1.5 ? [0, d / 2] : [0.1 * d, 0.5 * d, 0.9 * d]
  return raw.map((t) => Math.max(0, Math.min(t, d - 0.3)))
}

export async function prepareImageForAi(
  media: MediaCaller,
  src: string,
  outDir: string,
  name: string,
  opts: { signal?: AbortSignal; maxEdge?: number } = {},
): Promise<AiMedia> {
  const dst = join(outDir, name)
  const r = await media(
    'aiImage',
    { src, dst, maxEdge: opts.maxEdge ?? AI_IMAGE_MAX_EDGE },
    { timeoutMs: 60_000, ...(opts.signal ? { signal: opts.signal } : {}) },
  )
  return { path: dst, mime: 'image/jpeg', bytes: r.bytes, width: r.width, height: r.height }
}

export type FrameAt = { atMs: number } | { fromEndMs: number }
/** Extraction d'une image : renvoie vrai si un fichier non vide a été écrit. */
export type FrameExtractor = (src: string, dst: string, at: FrameAt) => Promise<boolean>

export function workerFrameExtractor(media: MediaCaller, signal?: AbortSignal): FrameExtractor {
  return async (src, dst, at) => {
    try {
      await media(
        'extractFrame',
        { src, dst, ...at, maxEdge: AI_FRAME_MAX_EDGE },
        { timeoutMs: 60_000, ...(signal ? { signal } : {}) },
      )
    } catch (err) {
      if (signal?.aborted) throw err
      return false
    }
    try {
      return statSync(dst).size > 0
    } catch {
      return false
    }
  }
}

export interface KeyframesResult {
  frames: string[]
  durationSec?: number
  /** Repli sur une image fixe (ffmpeg absent, pas de flux vidéo…). */
  fallback: boolean
}

/**
 * Images clés d'une vidéo, en cache sous `cacheDir/<uuid>/f1..f3.jpg` (réutilisées tant qu'elles
 * existent). `fallbackImage` (poster ou miniature) sert de repli final.
 */
export async function getVideoKeyframes(deps: {
  itemUuid: string
  video: string | null
  fallbackImage: string | null
  cacheDir: string
  durationSec: () => Promise<number | null>
  extract: FrameExtractor | null
}): Promise<KeyframesResult> {
  const dir = join(deps.cacheDir, deps.itemUuid)
  // Cache : toutes les images présentes et non vides.
  if (existsSync(dir)) {
    const names = (await readdir(dir)).filter((n) => /^f\d\.jpg$/.test(n)).sort()
    const ok: string[] = []
    for (const n of names) {
      const s = await stat(join(dir, n)).catch(() => null)
      if (s && s.size > 0) ok.push(join(dir, n))
    }
    if (ok.length > 0) {
      const d = await deps.durationSec().catch(() => null)
      return { frames: ok, ...(d ? { durationSec: d } : {}), fallback: false }
    }
  }
  const fallback = (durationSec?: number): KeyframesResult => ({
    frames: deps.fallbackImage ? [deps.fallbackImage] : [],
    ...(durationSec ? { durationSec } : {}),
    fallback: true,
  })
  if (!deps.video || !deps.extract) return fallback()
  const d = await deps.durationSec().catch(() => null)
  if (!d || d <= 0) return fallback()
  await mkdir(dir, { recursive: true })
  const frames: string[] = []
  const times = keyframeTimes(d)
  for (let i = 0; i < times.length; i++) {
    const dst = join(dir, `f${i + 1}.jpg`)
    const attempts: FrameAt[] = [{ atMs: times[i]! * 1000 }]
    if (i === times.length - 1 && times.length > 2) {
      attempts.push({ atMs: 0.8 * d * 1000 }, { fromEndMs: 500 })
    }
    let got = false
    for (const at of attempts) {
      if (await deps.extract(deps.video, dst, at)) {
        got = true
        break
      }
    }
    if (got) frames.push(dst)
    else await rm(dst, { force: true })
  }
  if (frames.length === 0) {
    await rm(dir, { recursive: true, force: true })
    return fallback(d)
  }
  return { frames, durationSec: d, fallback: false }
}

/** Purge des dossiers de job de plus d'une heure (AI §4, démarrage). */
export async function purgeOldJobDirs(jobsDir: string, now: number, maxAgeMs = 3_600_000) {
  if (!existsSync(jobsDir)) return 0
  let n = 0
  for (const name of await readdir(jobsDir)) {
    const p = join(jobsDir, name)
    const s = await stat(p).catch(() => null)
    if (s && now - s.mtimeMs > maxAgeMs) {
      await rm(p, { recursive: true, force: true })
      n++
    }
  }
  return n
}
