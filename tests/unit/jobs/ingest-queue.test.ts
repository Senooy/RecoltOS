/**
 * ingestion, file de jobs, dérivés, téléchargements distants .
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AppError } from '../../../src/shared/errors'
import { JOB_PRIORITY } from '../../../src/shared/jobs'
import { ingestPaths } from '../../../src/main/ingest/files'
import { ingest } from '../../../src/main/ingest/ingest'
import { upscaleAvatarUrl } from '../../../src/main/jobs/handlers/avatar-fetch'
import { cleanupAtOpen } from '../../../src/main/jobs/startup'
import { remoteRelFor, resetRemoteIndex } from '../../../src/main/library/remote-index'
import { startRemoteServer, type RemoteServer } from '../../helpers/remote-server'
import { makeImage, makeVideo } from '../../helpers/synthetic-media'
import { makeTmp } from '../media/helpers'
import { makeHarness, type JobsHarness } from './helpers'

let server: RemoteServer
let h: JobsHarness | null = null
const tmp = makeTmp('recolt-ingest-src-')

beforeAll(async () => {
  server = await startRemoteServer()
})
afterAll(async () => {
  await server.close()
  tmp.cleanup()
})
afterEach(async () => {
  await h?.cleanup()
  h = null
  resetRemoteIndex()
})

async function writeImages(n: number, prefix: string): Promise<string[]> {
  const dir = join(tmp.dir, prefix)
  mkdirSync(dir, { recursive: true })
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const p = join(dir, `img-${i}.png`)
    writeFileSync(
      p,
      await makeImage({
        width: 120 + i,
        height: 80 + i,
        color: `#${((i * 37 + 30) % 256).toString(16).padStart(2, '0')}6699`,
        format: 'png',
      }),
    )
    out.push(p)
  }
  return out
}

describe('ingestion', () => {
  it('20 fichiers → 20 items ; cartes émises avant les dérivés ; doublon ajouté à la collection', async () => {
    h = makeHarness()
    const paths = await writeImages(20, 'batch')
    const report = await ingestPaths(paths, {}, h.services)
    expect(report.added).toHaveLength(20)
    expect(report.failed).toEqual([])
    expect(h.t.repos.items.countLive()).toBe(20)
    // Avant toute exécution de la file : items en base, médias `processing`, événement `created`.
    expect(h.changes.filter((c) => c.reason === 'created')).toHaveLength(20)
    const processing = h.t.db
      .prepare("SELECT count(*) n FROM item_media WHERE status = 'processing'")
      .get() as { n: number }
    expect(processing.n).toBe(20)

    h.queue.start()
    await h.queue.whenIdle()
    const ok = h.t.db
      .prepare(
        "SELECT count(*) n FROM item_media WHERE status = 'ok' AND thumb_rel IS NOT NULL AND large_rel IS NOT NULL",
      )
      .get() as { n: number }
    expect(ok.n).toBe(20)
    const firstDerived = h.changes.findIndex((c) => c.reason === 'derived')
    const lastCreated = h.changes.map((c) => c.reason).lastIndexOf('created')
    expect(firstDerived).toBeGreaterThan(lastCreated)
    const withPalette = h.t.db
      .prepare('SELECT count(*) n FROM items WHERE palette IS NOT NULL AND color_bucket < 13')
      .get() as { n: number }
    expect(withPalette.n).toBe(20)

    // Doublon : même contenu → `duplicate`, ajouté à la collection demandée.
    const col = h.t.repos.collections.create({ name: 'Dev' })
    const dup = await ingest(
      { type: 'file', path: paths[3]! },
      { collectionUuid: col.uuid },
      h.services,
    )
    expect(dup.status).toBe('duplicate')
    expect(h.t.repos.items.countLive()).toBe(20)
    expect(h.t.repos.collections.itemIds(col.id)).toHaveLength(1)
  })

  it('doublon d’un élément en corbeille → restauré', async () => {
    h = makeHarness()
    const [p] = await writeImages(1, 'trash')
    const r1 = await ingest({ type: 'file', path: p! }, {}, h.services)
    const id = h.t.repos.items.getByUuid(r1.itemUuid)!.id
    h.t.repos.items.trash([id])
    const r2 = await ingest({ type: 'file', path: p! }, {}, h.services)
    expect(r2).toEqual({ itemUuid: r1.itemUuid, status: 'restored' })
    expect(h.t.repos.items.getById(id)!.deleted_at).toBeNull()
  })

  it('format non pris en charge refusé, avec message français, sans fichier temporaire', async () => {
    h = makeHarness()
    const p = join(tmp.dir, 'notes.txt')
    writeFileSync(p, 'bonjour')
    const report = await ingestPaths([p], {}, h.services)
    expect(report.failed).toEqual([
      { path: p, code: 'unsupported', message: 'Format non pris en charge : notes.txt' },
    ])
    expect(readdirSync(h.lib.paths.dir('tmp'))).toEqual([])
  })

  it('porte IA : provider off → aucun ai.enrich', async () => {
    h = makeHarness()
    const paths = await writeImages(2, 'ai')
    await ingestPaths(paths, {}, h.services)
    const n = h.t.db.prepare("SELECT count(*) n FROM jobs WHERE type = 'ai.enrich'").get() as {
      n: number
    }
    expect(n.n).toBe(0)
    const states = h.t.db.prepare('SELECT DISTINCT ai_state s FROM items').all()
    expect(states).toEqual([{ s: 'none' }])
  })
})

describe('vidéo', () => {
  it('ingestion vidéo : probe, poster ffmpeg, vignette, palette, puis aperçu de survol', async () => {
    h = makeHarness()
    const p = join(tmp.dir, 'clip.mp4')
    if (!makeVideo(p, { seconds: 2 })) return // ffmpeg absent : mode dégradé couvert ailleurs
    const r = await ingest({ type: 'file', path: p }, {}, h.services)
    const item = h.t.repos.items.getByUuid(r.itemUuid)!
    expect(item.kind).toBe('video')
    h.queue.start()
    await h.queue.whenIdle()
    const m = h.t.repos.media.listByItem(item.id)[0]!
    expect(m.status).toBe('ok')
    expect(m.poster_rel).toMatch(/^posters\//)
    expect(m.thumb_rel).toMatch(/^thumbs\//)
    expect(m.preview_rel).toMatch(/^previews\//)
    expect(existsSync(h.lib.paths.abs(m.preview_rel!))).toBe(true)
    expect(h.t.repos.items.getById(item.id)!.palette).not.toBeNull()
  })
})

describe('file de jobs', () => {
  it('reprise après kill : running → queued, .part orphelins purgés', async () => {
    h = makeHarness()
    const id = h.t.repos.jobs.enqueue({ type: 'purge.files', payload: { files: [], mode: 'rm' } })
    h.t.repos.jobs.claimNext('purge.files')
    expect(h.t.repos.jobs.get(id)!.state).toBe('running')
    mkdirSync(h.lib.paths.dir('tmp'), { recursive: true })
    const part = join(h.lib.paths.dir('tmp'), 'abc.part')
    writeFileSync(part, 'x')
    await cleanupAtOpen(h.lib)
    expect(h.t.repos.jobs.get(id)!.state).toBe('queued')
    expect(existsSync(part)).toBe(false)
  })

  it('un ai.enrich en pause ne retarde pas media.derive', async () => {
    h = makeHarness()
    const [p] = await writeImages(1, 'pause')
    await ingest({ type: 'file', path: p! }, {}, h.services)
    h.t.repos.jobs.enqueue({ type: 'ai.enrich', priority: JOB_PRIORITY.MANUAL })
    h.queue.pauseType('ai.enrich', null, 'test')
    h.queue.start()
    await h.queue.whenIdle()
    const rows = h.t.db.prepare('SELECT type, state FROM jobs ORDER BY id').all()
    expect(rows).toEqual([
      { type: 'media.derive', state: 'done' },
      { type: 'ai.enrich', state: 'queued' },
    ])
    expect(h.queue.status().byType['ai.enrich']!.pausedUntil).not.toBeNull()
  })

  it('provider_rate_limited remet en file sans consommer de tentative et met le type en pause', async () => {
    const retryAt = Date.now() + 3_600_000
    h = makeHarness({
      handlers: {
        'ai.enrich': () =>
          Promise.reject(new AppError('provider_rate_limited', 'limite', { retryAt })),
      },
    })
    const id = h.t.repos.jobs.enqueue({ type: 'ai.enrich' })
    h.queue.start()
    await h.queue.whenIdle()
    const row = h.t.repos.jobs.getRow(id)!
    expect(row).toMatchObject({ state: 'queued', attempts: 0, run_after: retryAt })
    expect(h.queue.status().byType['ai.enrich']!.pausedUntil).toBe(retryAt)
    expect(h.t.repos.settings.get('jobs.paused')).toMatchObject({ 'ai.enrich': { until: retryAt } })
  })

  it('échec réessayable : backoff 2^n × 30 s ; 4xx non réessayé', async () => {
    let calls = 0
    h = makeHarness({
      handlers: {
        'ai.enrich': () => {
          calls++
          return Promise.reject(new AppError('io', 'disque'))
        },
        'ai.prompt': () => Promise.reject(new AppError('http_4xx', 'réponse 404', { status: 404 })),
      },
    })
    const a = h.t.repos.jobs.enqueue({ type: 'ai.enrich' })
    const b = h.t.repos.jobs.enqueue({ type: 'ai.prompt' })
    const before = Date.now()
    h.queue.start()
    await h.queue.whenIdle()
    expect(calls).toBe(1)
    const ra = h.t.repos.jobs.getRow(a)!
    expect(ra.state).toBe('queued')
    expect(ra.run_after).toBeGreaterThanOrEqual(before + 60_000)
    expect(h.t.repos.jobs.getRow(b)!.state).toBe('failed')
  })

  it('crash après le commit du DELETE : purge.files supprime les fichiers au redémarrage', async () => {
    h = makeHarness()
    const [p] = await writeImages(1, 'purge')
    const r = await ingest({ type: 'file', path: p! }, {}, h.services)
    const item = h.t.repos.items.getByUuid(r.itemUuid)!
    const file = h.lib.paths.abs(h.t.repos.media.listByItem(item.id)[0]!.file_rel!)
    expect(existsSync(file)).toBe(true)
    // « Crash » : la transaction est validée, aucun job n'a tourné.
    const res = h.t.repos.items.purge([item.id])
    expect(res.jobId).not.toBeNull()
    expect(existsSync(file)).toBe(true)
    await cleanupAtOpen(h.lib)
    h.queue.start()
    await h.queue.whenIdle()
    expect(existsSync(file)).toBe(false)
    expect(h.t.repos.jobs.getRow(res.jobId!)!.state).toBe('done')
  })
})

describe('téléchargements distants', () => {
  it('remote.fetch écrit remote/<sha1>.<ext> ; 403 → échec, aucune entrée', async () => {
    h = makeHarness()
    const ok = server.url('/media/quoted.jpg')
    const ko = server.url('/expired/quoted.jpg')
    h.t.repos.jobs.enqueue({
      type: 'remote.fetch',
      dedupeKey: `remote:${ok}`,
      payload: { url: ok },
    })
    const failId = h.t.repos.jobs.enqueue({
      type: 'remote.fetch',
      dedupeKey: `remote:${ko}`,
      payload: { url: ko },
    })
    h.queue.start()
    await h.queue.whenIdle()
    const relOk = remoteRelFor(h.lib.root, ok)
    const sha = createHash('sha1').update(ok).digest('hex')
    expect(relOk).toBe(`remote/${sha}.jpg`)
    expect(existsSync(h.lib.paths.abs(relOk!))).toBe(true)
    expect(remoteRelFor(h.lib.root, ko)).toBeNull()
    expect(h.t.repos.jobs.getRow(failId)!.state).toBe('failed')
  })

  it('media.download : 200 → ok + dérivés ; 403 → missing sans nouvelle tentative', async () => {
    h = makeHarness()
    const item = h.t.repos.items.insertWithMedia({ kind: 'image', source: 'x' }, [
      {
        mediaType: 'image',
        status: 'remote',
        remoteUrl: server.url('/media/slide.png'),
        position: 0,
      },
      {
        mediaType: 'image',
        status: 'remote',
        remoteUrl: server.url('/expired/slide.png'),
        position: 1,
      },
    ])
    for (const mid of item.mediaIds) {
      h.t.repos.jobs.enqueue({
        type: 'media.download',
        dedupeKey: `dl:${mid}`,
        payload: { mediaId: mid },
      })
    }
    h.queue.start()
    await h.queue.whenIdle()
    const [m0, m1] = item.mediaIds.map((id) => h!.t.repos.media.getById(id)!)
    expect(m0).toMatchObject({ status: 'ok', mime: 'image/png' })
    expect(m0!.thumb_rel).toMatch(/^thumbs\//)
    expect(m1!.status).toBe('missing')
    const dl = h.t.db
      .prepare("SELECT state, attempts FROM jobs WHERE type = 'media.download' ORDER BY id")
      .all()
    expect(dl).toEqual([
      { state: 'done', attempts: 1 },
      { state: 'failed', attempts: 1 },
    ])
  })

  it('avatar.fetch : _normal → _400x400 ; 403 → failed (monogramme)', async () => {
    expect(upscaleAvatarUrl('https://pbs.twimg.com/profile_images/1/abc_normal.jpg')).toBe(
      'https://pbs.twimg.com/profile_images/1/abc_400x400.jpg',
    )
    h = makeHarness()
    const okId = h.t.repos.authors.upsert({
      platform: 'x',
      handle: 'alice',
      avatarUrl: server.url('/avatar/alice.jpg'),
    })
    const koId = h.t.repos.authors.upsert({
      platform: 'instagram',
      handle: 'bob',
      avatarUrl: server.url('/expired/bob.jpg'),
    })
    for (const id of [okId, koId]) {
      h.t.repos.jobs.enqueue({
        type: 'avatar.fetch',
        dedupeKey: `author:${id}`,
        payload: { authorId: id },
      })
    }
    h.queue.start()
    await h.queue.whenIdle()
    const ok = h.t.repos.authors.getById(okId)!
    expect(ok.avatar_status).toBe('ok')
    expect(existsSync(h.lib.paths.abs(ok.avatar_rel!))).toBe(true)
    expect(h.t.repos.authors.getById(koId)!.avatar_status).toBe('failed')
  })
})
