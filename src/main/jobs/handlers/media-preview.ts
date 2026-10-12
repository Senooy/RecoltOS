/**
 * Job `media.preview` : aperçu de survol `previews/<ab>/<uuid>.mp4`, 540p, ≤ 8 s, muet
 * (`h264_videotoolbox`, repli libx264, dans le media-worker). Sans ffmpeg : `tool_missing`.
 */
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AppError } from '../../../shared/errors'
import { rel } from '../../library/paths'
import { payloadId, type JobHandler } from './types'
import { mt } from '../../i18n'

export const mediaPreview: JobHandler = async (job, ctx) => {
  const mediaId = payloadId(job, 'mediaId')
  if (mediaId === null)
    return { status: 'failed', error: { code: 'validation', message: 'mediaId manquant' } }
  const m = ctx.lib.repos.media.getById(mediaId)
  if (!m || m.media_type !== 'video' || !m.file_rel || m.status === 'remote')
    return { status: 'done' }
  if (!ctx.hasTool('ffmpeg')) throw new AppError('tool_missing', mt().errors.ffmpegMissing)
  const previewRel = rel.preview(m.uuid)
  const dst = ctx.lib.paths.abs(previewRel)
  await mkdir(dirname(dst), { recursive: true })
  await ctx.media(
    'makePreview',
    { src: ctx.lib.paths.abs(m.file_rel), dst, maxSeconds: 8, height: 540 },
    { jobId: job.id, signal: ctx.signal, timeoutMs: 300_000 },
  )
  ctx.lib.repos.media.update(m.id, { previewRel })
  const item = ctx.lib.repos.items.getById(m.item_id)
  if (item) ctx.changed([item.uuid], 'derived')
  return { status: 'done' }
}
