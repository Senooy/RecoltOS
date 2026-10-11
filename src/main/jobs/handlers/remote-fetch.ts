/**
 * Job `remote.fetch` (PLAN §1.6) : image citée, image de fil ou slide distante sans ligne
 * `item_media` → `remote/<sha1(url)>.<ext>`. Le DTO n'expose l'URL `recolt://` que si le fichier
 * existe (`library/remote-index.ts`) ; une réponse 4xx laisse l'image masquée (aucune URL http(s)).
 */
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AppError } from '../../../shared/errors'
import { detectType } from '../../ingest/media-type'
import { rel } from '../../library/paths'
import { recordRemote, remoteRelFor } from '../../library/remote-index'
import { fetchToFile } from '../fetch'
import { payloadString, type JobHandler } from './types'

export const remoteFetch: JobHandler = async (job, ctx) => {
  const { lib } = ctx
  const url = payloadString(job, 'url')
  if (!url) return { status: 'failed', error: { code: 'validation', message: 'url manquante' } }
  if (remoteRelFor(lib.root, url)) return { status: 'done' }
  if (!ctx.prefs().storage.downloadRemoteMedia) {
    return {
      status: 'failed',
      error: { code: 'disabled', message: 'téléchargement des médias distants désactivé' },
    }
  }
  const tmp = lib.paths.abs(rel.tmp(`remote-${job.id}.part`))
  const got = await fetchToFile(ctx.fetch, url, tmp, {
    signal: ctx.signal,
    maxBytes: 200 * 1024 ** 2,
  })
  const type = await detectType(got.head)
  if (!type || type.mediaType !== 'image') {
    await rm(tmp, { force: true })
    throw new AppError('unsupported', 'image distante illisible')
  }
  const remoteRel = rel.remote(url, type.ext)
  const abs = lib.paths.abs(remoteRel)
  await mkdir(dirname(abs), { recursive: true })
  await rename(tmp, abs)
  recordRemote(lib.root, url, remoteRel)
  const itemUuid = payloadString(job, 'itemUuid')
  if (itemUuid) ctx.changed([itemUuid], 'derived')
  return { status: 'done' }
}
