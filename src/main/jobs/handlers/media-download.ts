/**
 * Job `media.download` (ARCHI §5.2 étape 10, §6.4) : média de carrousel distant (`status='remote'`)
 * téléchargé dans `items/<ab>/<uuid>.<ext>` (et son poster), puis `media.derive`. Une réponse 4xx
 * le passe en `missing` sans nouvelle tentative. Gouverné par `prefs.storage.downloadRemoteMedia`.
 * Point d'extension : `registerFetchPolicy` (`../fetch`), utilisé par la sync (WP-56).
 */
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AppError } from '../../../shared/errors'
import { JOB_PRIORITY } from '../../../shared/jobs'
import { detectType } from '../../ingest/media-type'
import { rel } from '../../library/paths'
import { fetchToFile } from '../fetch'
import { payloadId, type JobFailureHook, type JobHandler } from './types'

export { registerFetchPolicy } from '../fetch'

export const mediaDownload: JobHandler = async (job, ctx) => {
  const { lib } = ctx
  const mediaId = payloadId(job, 'mediaId')
  if (mediaId === null)
    return { status: 'failed', error: { code: 'validation', message: 'mediaId manquant' } }
  const m = lib.repos.media.getById(mediaId)
  if (!m || m.status !== 'remote') return { status: 'done' }
  if (!ctx.prefs().storage.downloadRemoteMedia) {
    return {
      status: 'failed',
      error: { code: 'disabled', message: 'téléchargement des médias distants désactivé' },
    }
  }
  if (!m.remote_url) throw new AppError('not_found', 'URL distante absente')
  const tmp = lib.paths.abs(rel.tmp(`${m.uuid}.part`))
  const got = await fetchToFile(ctx.fetch, m.remote_url, tmp, { signal: ctx.signal })
  const type = await detectType(got.head)
  if (!type) {
    await rm(tmp, { force: true })
    throw new AppError('unsupported', 'contenu distant non pris en charge')
  }
  const fileRel = rel.original(m.uuid, type.ext)
  const fileAbs = lib.paths.abs(fileRel)
  await mkdir(dirname(fileAbs), { recursive: true })
  await rename(tmp, fileAbs)

  let posterRel = m.poster_rel
  if (type.mediaType === 'video' && !posterRel && m.remote_poster_url) {
    const ptmp = lib.paths.abs(rel.tmp(`${m.uuid}.poster.part`))
    try {
      await fetchToFile(ctx.fetch, m.remote_poster_url, ptmp, { signal: ctx.signal })
      posterRel = rel.poster(m.uuid)
      const pAbs = lib.paths.abs(posterRel)
      await mkdir(dirname(pAbs), { recursive: true })
      await rename(ptmp, pAbs)
    } catch (err) {
      await rm(ptmp, { force: true })
      posterRel = null
      ctx.log.warn(`[jobs] poster distant indisponible pour ${m.uuid}`, err)
    }
  }

  lib.db.transaction(() => {
    lib.repos.media.update(m.id, {
      status: 'processing',
      fileRel,
      mime: type.mime,
      mediaType: type.mediaType,
      fileSize: got.bytes,
      contentHash: got.sha256,
      posterRel,
    })
    lib.repos.jobs.enqueue({
      type: 'media.derive',
      itemId: m.item_id,
      dedupeKey: `media:${m.id}`,
      payload: { mediaId: m.id },
      priority: Math.max(job.priority, JOB_PRIORITY.IMPORT_HIGH),
    })
  })()
  const item = lib.repos.items.getById(m.item_id)
  if (item) ctx.changed([item.uuid], 'updated')
  ctx.kick()
  return { status: 'done' }
}

/** Échec définitif (4xx, désactivé…) : `missing`, l'élément garde sa couverture. */
export const mediaDownloadFailed: JobFailureHook = (job, error, s) => {
  const mediaId = payloadId(job, 'mediaId')
  if (mediaId === null || error.code === 'disabled') return
  const m = s.lib.repos.media.getById(mediaId)
  if (!m || m.status !== 'remote') return
  s.lib.repos.media.setStatus(mediaId, 'missing')
  const item = s.lib.repos.items.getById(m.item_id)
  if (item) s.changed([item.uuid], 'updated')
}
