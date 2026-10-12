/**
 * `avatar.fetch` job: author avatar → `avatars/<platform>/<k>.jpg`
 * (128 px square), `authors.updated_at` serves as `?v=`. X: `_normal` → `_400x400`. A 4xx response
 * (expired Instagram avatars) sets `avatar_status='failed'` without retry: the UI shows
 * a monogram.
 */
import type Database from 'better-sqlite3'
import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { rel } from '../../library/paths'
import { fetchToFile } from '../fetch'
import { payloadId, type JobFailureHook, type JobHandler } from './types'

/** Avatar URL at the best resolution (X: `_normal` 48 px → `_400x400`). */
export function upscaleAvatarUrl(url: string): string {
  return url.replace(/_normal(\.[a-z]+)(\?.*)?$/i, '_400x400$1$2')
}

function itemsOfAuthor(db: Database.Database, id: number): string[] {
  return (
    db.prepare('SELECT uuid FROM items WHERE author_id = ?').all(id) as { uuid: string }[]
  ).map((r) => r.uuid)
}

export const avatarFetch: JobHandler = async (job, ctx) => {
  const { lib } = ctx
  const authorId = payloadId(job, 'authorId')
  if (authorId === null)
    return { status: 'failed', error: { code: 'validation', message: 'missing authorId' } }
  const a = lib.repos.authors.getById(authorId)
  if (!a?.avatar_url || a.avatar_status === 'ok') return { status: 'done' }
  if (!ctx.prefs().storage.downloadRemoteMedia) {
    return {
      status: 'failed',
      error: { code: 'disabled', message: 'remote media download disabled' },
    }
  }
  const tmp = lib.paths.abs(rel.tmp(`avatar-${a.id}.part`))
  try {
    let url = upscaleAvatarUrl(a.avatar_url)
    try {
      await fetchToFile(ctx.fetch, url, tmp, { signal: ctx.signal, maxBytes: 20 * 1024 ** 2 })
    } catch (err) {
      // Falls back to the original URL if the enlarged variant does not exist.
      if (url === a.avatar_url) throw err
      url = a.avatar_url
      await fetchToFile(ctx.fetch, url, tmp, { signal: ctx.signal, maxBytes: 20 * 1024 ** 2 })
    }
    const avatarRel = rel.avatar(a.platform, a.handle)
    const dst = lib.paths.abs(avatarRel)
    await mkdir(dirname(dst), { recursive: true })
    await ctx.media(
      'makeAvatar',
      { src: tmp, dst, size: 128 },
      { jobId: job.id, signal: ctx.signal, timeoutMs: 60_000 },
    )
    lib.repos.authors.setAvatar(a.id, 'ok', avatarRel, ctx.now())
    ctx.changed(itemsOfAuthor(lib.db, a.id), 'derived')
    return { status: 'done' }
  } finally {
    await rm(tmp, { force: true })
  }
}

export const avatarFetchFailed: JobFailureHook = (job, error, s) => {
  const authorId = payloadId(job, 'authorId')
  if (authorId === null || error.code === 'disabled') return
  s.lib.repos.authors.setAvatar(authorId, 'failed', null)
}
