/**
 * Job `media.derive` (ARCHI §5.2 étape 9, PLAN §1.6) : `thumbs/` 800w webp, `large/` 1440w webp,
 * poster ffmpeg pour une vidéo qui n'en a pas, palette k-means Lab pour le média de couverture
 * sans palette (vidéos importées, nouveaux ajouts), suppression de la miniature GatherOS
 * (`legacy_thumb_rel`), `status='ok'`, `derive_version++`, puis `items.changed{derived}`.
 * Une vidéo reçoit ensuite un job `media.preview` (aperçu muet de survol).
 */
import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { hueBucket, labToLch } from '../../../shared/color'
import { AppError } from '../../../shared/errors'
import { JOB_PRIORITY } from '../../../shared/jobs'
import { rel } from '../../library/paths'
import { payloadId, type JobFailureHook, type JobHandler } from './types'

const IMAGE_TIMEOUT = 60_000
const VIDEO_TIMEOUT = 180_000

async function exists(abs: string): Promise<boolean> {
  return stat(abs).then(
    (s) => s.isFile() && s.size > 0,
    () => false,
  )
}

export const mediaDerive: JobHandler = async (job, ctx) => {
  const { lib } = ctx
  const mediaId = payloadId(job, 'mediaId')
  if (mediaId === null)
    return { status: 'failed', error: { code: 'validation', message: 'mediaId manquant' } }
  const m = lib.repos.media.getById(mediaId)
  if (!m) return { status: 'done' }
  if (m.status === 'remote') {
    // Pas encore téléchargé : `media.download` relancera le dérivé.
    return { status: 'done' }
  }
  if (!m.file_rel) throw new AppError('not_found', 'média sans fichier')
  const originalAbs = lib.paths.abs(m.file_rel)
  if (!(await exists(originalAbs)))
    throw new AppError('not_found', `fichier introuvable : ${m.file_rel}`)
  const call = { jobId: job.id, signal: ctx.signal }

  let posterRel = m.poster_rel
  let width = m.width
  let height = m.height
  const patch: Parameters<typeof lib.repos.media.update>[1] = {}

  // Source des dérivés : image (ou son display), poster pour une vidéo.
  let srcAbs: string
  if (m.media_type === 'video') {
    if (ctx.hasTool('ffprobe') && (m.duration_ms === null || width === null || height === null)) {
      const p = await ctx.media(
        'probeVideo',
        { abs: originalAbs },
        { ...call, timeoutMs: IMAGE_TIMEOUT },
      )
      patch.durationMs = p.durationMs
      patch.hasAudio = p.hasAudio
      patch.playable = p.playable
      if (width === null || height === null) {
        width = p.width
        height = p.height
        patch.width = width
        patch.height = height
      }
    }
    if (!posterRel || !(await exists(lib.paths.abs(posterRel)))) {
      if (!ctx.hasTool('ffmpeg')) throw new AppError('tool_missing', 'ffmpeg est introuvable.')
      posterRel = rel.poster(m.uuid)
      const pAbs = lib.paths.abs(posterRel)
      await mkdir(dirname(pAbs), { recursive: true })
      const dur = patch.durationMs ?? m.duration_ms ?? 0
      await ctx.media(
        'makePoster',
        { src: originalAbs, dst: pAbs, atMs: Math.round(Math.min(1000, dur * 0.1)) },
        { ...call, timeoutMs: VIDEO_TIMEOUT },
      )
      patch.posterRel = posterRel
    }
    srcAbs = lib.paths.abs(posterRel)
  } else {
    srcAbs = m.display_rel ? lib.paths.abs(m.display_rel) : originalAbs
    if (width === null || height === null) {
      const p = await ctx.media(
        'probeImage',
        { abs: srcAbs },
        { ...call, timeoutMs: IMAGE_TIMEOUT },
      )
      width = p.width
      height = p.height
      patch.width = width
      patch.height = height
      patch.isAnimated = p.isAnimated
    }
  }

  const thumbRel = rel.thumb(m.uuid)
  const largeRel = rel.large(m.uuid)
  const thumbAbs = lib.paths.abs(thumbRel)
  const largeAbs = lib.paths.abs(largeRel)
  await mkdir(dirname(thumbAbs), { recursive: true })
  await mkdir(dirname(largeAbs), { recursive: true })
  await ctx.media(
    'makeThumb',
    { src: srcAbs, dst: thumbAbs, width: 800 },
    { ...call, timeoutMs: IMAGE_TIMEOUT },
  )
  await ctx.media(
    'makeLarge',
    { src: srcAbs, dst: largeAbs, width: 1440 },
    { ...call, timeoutMs: IMAGE_TIMEOUT },
  )

  // Palette : média de couverture d'un item sans palette (les palettes importées sont conservées).
  const item = lib.repos.items.getById(m.item_id)
  let paletteDone = false
  let palette: { hex: string[]; lab: [number, number, number][]; share: number[] } | null = null
  if (item && item.cover_media_id === m.id && item.palette === null) {
    try {
      palette = await ctx.media('palette', { src: thumbAbs }, { ...call, timeoutMs: IMAGE_TIMEOUT })
    } catch (err) {
      ctx.log.warn(`[jobs] palette impossible pour ${m.uuid}`, err)
    }
  }

  const legacy = m.legacy_thumb_rel
  lib.db.transaction(() => {
    lib.repos.media.update(m.id, {
      ...patch,
      thumbRel,
      largeRel,
      legacyThumbRel: null,
      status: 'ok',
      deriveVersion: m.derive_version + 1,
    })
    if (item && palette && palette.hex.length > 0) {
      const first = palette.lab[0]!
      const lch = labToLch(first)
      lib.repos.items.update(item.id, {
        palette: palette.hex,
        paletteLab: palette.lab,
        paletteWeights: palette.share,
        colorL: lch[0],
        colorC: lch[1],
        colorH: lch[2],
        colorBucket: hueBucket(lch),
        updatedAt: item.updated_at,
      })
      paletteDone = true
    }
    if (m.media_type === 'video' && ctx.hasTool('ffmpeg') && !m.preview_rel) {
      lib.repos.jobs.enqueue({
        type: 'media.preview',
        itemId: m.item_id,
        dedupeKey: `preview:${m.id}`,
        payload: { mediaId: m.id },
        priority: JOB_PRIORITY.BACKGROUND,
      })
    }
  })()
  if (legacy) await rm(lib.paths.abs(legacy), { force: true }).catch(() => undefined)
  if (item) ctx.changed([item.uuid], 'derived')
  if (paletteDone) ctx.log.info(`[jobs] palette calculée pour ${item?.uuid ?? m.uuid}`)
  ctx.kick()
  return { status: 'done' }
}

/** Échec définitif : le média passe en `missing` (fichier perdu) ou `failed`. */
export const mediaDeriveFailed: JobFailureHook = (job, error, s) => {
  const mediaId = payloadId(job, 'mediaId')
  if (mediaId === null) return
  const m = s.lib.repos.media.getById(mediaId)
  if (!m || m.status === 'ok') return
  s.lib.repos.media.setStatus(mediaId, error.code === 'not_found' ? 'missing' : 'failed')
  const item = s.lib.repos.items.getById(m.item_id)
  if (item) s.changed([item.uuid], 'updated')
}
