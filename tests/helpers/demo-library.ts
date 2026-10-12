/**
 * Demo library: generation, cache and cloning. Importable from vitest, from Playwright
 * (CJS: no `import.meta`, the root comes from `paths.ts`) and from scripts
 * (`scripts/make-fixtures.mts` is only a CLI on top of this module).
 *
 * Builds a complete `userData`: `libraries.json` + `libraries/default/recolt.db` (schema =
 * production migrations `src/main/db/migrations/*.sql`, `user_version` set as in `db/migrate.ts`)
 * + tiny synthetic media (originals, 800w thumbnails, posters, avatars in local cache).
 * 100% synthetic data (`synthetic-items.ts`), no real data.
 *
 * Accepted deviation from "via the production code": ingestion and repos do not exist yet at
 * this point; rows are inserted by direct SQL (`db.ts#seedSyntheticLibrary`) with `shard()` from
 * `src/shared/ids.ts`. This will be replaced by the real ingestion.
 *
 * Cache: `node_modules/.cache/recoltos-demo/<key>/`, key = hash of this module, of the synthesis
 * helpers (`synthetic-items.ts` imports `src/shared/color.ts`, `synthetic-media.ts`, `db.ts`), of
 * `src/shared/ids.ts` (generation of `shard()` identifiers), of the migrations, of the sharp and
 * ffmpeg versions, and of the parameters. The output is an APFS clone (`cp -c`) of the cache entry.
 * `isDemoLibraryCurrent` compares `user_version` with the latest migration: a copy older than a
 * new migration is regenerated (`--if-missing`).
 */
import Database from 'better-sqlite3'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import sharp from 'sharp'
import { shard } from '../../src/shared/ids'
import { listMigrations, openTestDb, seedSyntheticLibrary, type TestDb } from './db'
import { REPO_ROOT as ROOT } from './paths'
import { assertSafeOutDir, markFixtureDir } from './safe-out'
import { findFfmpeg, makeImage, makeVideo } from './synthetic-media'
import { makeSyntheticLibrary, type SyntheticItem, type SyntheticLibrary } from './synthetic-items'

const LONG_SIDE = 480
const THUMB_SIDE = 320

export interface DemoOptions {
  /** Number of live items (60 for the e2e demo, 408 for parity with the real library). */
  count?: number
  /** Number of collections kept (the fullest ones). */
  collections?: number
  trashed?: number
  hidden?: number
}

export interface DemoResult {
  userData: string
  libraryDir: string
  items: number
  media: number
  videos: number
  ffmpeg: boolean
}

const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex')

/** Number of the latest migration (`NNNN_name.sql`): the expected value of `PRAGMA user_version`. */
export function latestMigrationVersion(): number {
  return Math.max(0, ...listMigrations().map((m) => m.version))
}

/**
 * True if `userData` contains a complete AND up-to-date demo library: `libraries.json`, database
 * `libraries/default/recolt.db` openable read-only, `user_version` = latest migration.
 * Any error (missing, corrupted or locked database) = "not up to date": we regenerate rather than guess.
 */
export function isDemoLibraryCurrent(userData: string): boolean {
  const file = join(userData, 'libraries', 'default', 'recolt.db')
  if (!existsSync(join(userData, 'libraries.json')) || !existsSync(file)) return false
  let db: Database.Database | undefined
  try {
    db = new Database(file, { readonly: true, fileMustExist: true })
    return db.pragma('user_version', { simple: true }) === latestMigrationVersion()
  } catch {
    return false
  } finally {
    db?.close()
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: the process exists but belongs to another user. ESRCH: it no longer exists.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Removes the `<cache>.building-<pid>` left by an interrupted build. A build whose pid is still
 * alive (concurrent launch) is spared.
 */
function removeStaleBuilds(cache: string): void {
  const dir = dirname(cache)
  if (!existsSync(dir)) return
  const prefix = `${basename(cache)}.building-`
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix)) continue
    const pid = Number(name.slice(prefix.length))
    if (Number.isInteger(pid) && pid > 0 && isPidAlive(pid)) continue
    rmSync(join(dir, name), { recursive: true, force: true })
  }
}

/** Avatar key: sha1(lower(handle)) over 16 hex chars. */
export const avatarKey = (handle: string): string => sha1(handle.toLowerCase()).slice(0, 16)

function ffmpegVersion(): string {
  const bin = findFfmpeg()
  if (!bin) return 'none'
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8' })
  return (r.stdout.split('\n')[0] ?? '').trim()
}

export function cacheKey(options: Required<DemoOptions>): string {
  const h = createHash('sha256')
  const files = [
    'tests/helpers/demo-library.ts',
    'tests/helpers/synthetic-items.ts',
    'tests/helpers/synthetic-media.ts',
    'tests/helpers/db.ts',
    'src/shared/ids.ts',
    'src/shared/color.ts',
    ...readdirSync(join(ROOT, 'src/main/db/migrations'))
      .sort()
      .map((f) => `src/main/db/migrations/${f}`),
  ]
  for (const f of files) {
    h.update(f)
    h.update(readFileSync(join(ROOT, f)))
  }
  h.update(JSON.stringify(options))
  h.update((sharp.versions as { sharp?: string }).sharp ?? sharp.versions.vips)
  h.update(ffmpegVersion())
  return h.digest('hex').slice(0, 16)
}

/** Reduces the dimensions so the files stay tiny (ratio kept). */
function shrink(items: SyntheticItem[]): void {
  for (const it of items) {
    for (const m of it.media) {
      const f = LONG_SIDE / Math.max(m.width, m.height)
      m.width = Math.max(24, Math.round(m.width * f))
      m.height = Math.max(24, Math.round(m.height * f))
    }
    if (it.media[0]) {
      it.width = it.media[0].width
      it.height = it.media[0].height
    }
  }
}

function keepCollections(lib: SyntheticLibrary, n: number): void {
  lib.collections = [...lib.collections]
    .filter((c) => c.itemIndexes.length > 0)
    .sort((a, b) => b.itemIndexes.length - a.itemIndexes.length)
    .slice(0, n)
}

async function writeMedia(libraryDir: string, lib: SyntheticLibrary, db: TestDb): Promise<number> {
  const videoSamples = new Map<string, string>()
  let videos = 0
  const sampleDir = join(libraryDir, 'tmp')
  mkdirSync(sampleDir, { recursive: true })
  const updateMedia = db.prepare(
    'UPDATE item_media SET thumb_rel = ?, poster_rel = ?, file_size = ?, content_hash = ? WHERE uuid = ?',
  )

  for (const it of lib.items) {
    for (const m of it.media) {
      const ab = shard(m.uuid)
      const [c0, c1] = it.palette ?? [it.index % 2 ? '#c8a064' : '#6486c8', '#f0e6d2']
      const thumbRel = `thumbs/${ab}/${m.uuid}.webp`
      const thumbFile = join(libraryDir, thumbRel)
      mkdirSync(dirname(thumbFile), { recursive: true })
      const tw = Math.min(m.width, THUMB_SIDE)
      const th = Math.max(1, Math.round((tw * m.height) / m.width))
      const thumb = await makeImage({ width: tw, height: th, color: c0, to: c1, format: 'webp' })
      writeFileSync(thumbFile, thumb)

      const original = join(libraryDir, `items/${ab}/${m.uuid}.${m.ext}`)
      mkdirSync(dirname(original), { recursive: true })
      let posterRel: string | null = null
      if (m.mediaType === 'video') {
        // Three sample mp4s (portrait, landscape, square) cloned for all the other videos.
        const orientation =
          m.width > m.height ? 'paysage' : m.width < m.height ? 'portrait' : 'carre'
        const dims = { paysage: [112, 64], portrait: [64, 112], carre: [80, 80] }[orientation] as [
          number,
          number,
        ]
        let sample = videoSamples.get(orientation)
        if (sample === undefined) {
          const file = join(sampleDir, `sample-${orientation}.mp4`)
          // Without ffmpeg: empty file, poster only (degraded mode).
          sample = makeVideo(file, { width: dims[0], height: dims[1] }) ? file : ''
          videoSamples.set(orientation, sample)
        }
        if (sample) {
          cpSync(sample, original)
          videos += 1
        } else {
          writeFileSync(original, Buffer.alloc(0))
        }
        posterRel = `posters/${ab}/${m.uuid}.jpg`
        mkdirSync(dirname(join(libraryDir, posterRel)), { recursive: true })
        writeFileSync(
          join(libraryDir, posterRel),
          await makeImage({ width: tw, height: th, color: c0, to: c1, format: 'jpeg' }),
        )
      } else {
        const full = await makeImage({
          width: m.width,
          height: m.height,
          color: c0,
          to: c1,
          format: 'webp',
        })
        writeFileSync(original, full)
      }
      const bytes = readFileSync(original)
      const hash = createHash('sha256').update(bytes).digest('hex')
      updateMedia.run(thumbRel, posterRel, bytes.length, hash, m.uuid)
    }
  }
  rmSync(sampleDir, { recursive: true, force: true })
  return videos
}

async function writeAvatars(libraryDir: string, db: TestDb): Promise<void> {
  const authors = db.prepare('SELECT id, platform, handle FROM authors').all() as {
    id: number
    platform: string
    handle: string
  }[]
  const upd = db.prepare('UPDATE authors SET avatar_rel = ?, avatar_status = ? WHERE id = ?')
  for (const a of authors) {
    // Instagram avatars are all expired in the real library: monogram.
    if (a.platform === 'instagram') {
      upd.run(null, 'expired', a.id)
      continue
    }
    const rel = `avatars/${a.platform}/${avatarKey(a.handle)}.jpg`
    const file = join(libraryDir, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(
      file,
      await makeImage({
        width: 64,
        height: 64,
        color: `#${sha1(a.handle).slice(0, 6)}`,
        format: 'jpeg',
      }),
    )
    upd.run(rel, 'ok', a.id)
  }
}

async function build(target: string, options: Required<DemoOptions>): Promise<DemoResult> {
  rmSync(target, { recursive: true, force: true })
  const libraryDir = join(target, 'libraries', 'default')
  mkdirSync(libraryDir, { recursive: true })
  markFixtureDir(target, 'make-fixtures')

  const lib = makeSyntheticLibrary({
    count: options.count,
    trashed: options.trashed,
    hidden: options.hidden,
  })
  keepCollections(lib, options.collections)
  shrink(lib.items)

  const db = openTestDb({ file: join(libraryDir, 'recolt.db') })
  try {
    seedSyntheticLibrary(db, lib, { withDerived: true })
    const videos = await writeMedia(libraryDir, lib, db)
    await writeAvatars(libraryDir, db)
    db.exec('ANALYZE')
    db.pragma('wal_checkpoint(TRUNCATE)')
    const media = (db.prepare('SELECT count(*) n FROM item_media').get() as { n: number }).n
    writeFileSync(
      join(target, 'libraries.json'),
      JSON.stringify(
        {
          version: 1,
          active: 'default',
          libraries: [
            { id: 'default', name: 'Bibliothèque', path: null, createdAt: 1_791_700_000_000 },
          ],
        },
        null,
        2,
      ) + '\n',
    )
    return {
      userData: target,
      libraryDir,
      items: lib.items.length,
      media,
      videos,
      ffmpeg: findFfmpeg() !== null,
    }
  } finally {
    db.close()
  }
}

/** APFS clone when possible (`cp -c`), plain copy otherwise. */
export function cloneDir(from: string, to: string, options: { force?: boolean } = {}): void {
  assertSafeOutDir(to, options)
  rmSync(to, { recursive: true, force: true })
  mkdirSync(dirname(to), { recursive: true })
  const r = spawnSync('cp', ['-cR', from, to])
  if (r.status !== 0) cpSync(from, to, { recursive: true })
}

export async function makeDemoLibrary(
  out: string,
  options: DemoOptions = {},
  useCache = true,
  safety: { force?: boolean } = {},
): Promise<DemoResult & { cached: boolean }> {
  const opts: Required<DemoOptions> = {
    count: options.count ?? 60,
    collections: options.collections ?? 6,
    trashed: options.trashed ?? 0,
    hidden: options.hidden ?? 0,
  }
  // `build` and `cloneDir` delete `target`: check BEFORE any write (see safe-out.ts).
  const target = assertSafeOutDir(out, safety)
  if (!useCache) return { ...(await build(target, opts)), cached: false }

  const cache = join(ROOT, 'node_modules/.cache/recoltos-demo', cacheKey(opts))
  // Cleanup on every call (not only when rebuilding): an interrupted build must not
  // accumulate, even if the current cache already exists.
  removeStaleBuilds(cache)
  let cached = true
  if (!existsSync(join(cache, 'libraries.json'))) {
    cached = false
    const tmp = `${cache}.building-${process.pid}`
    try {
      await build(tmp, opts)
    } catch (err) {
      rmSync(tmp, { recursive: true, force: true })
      throw err
    }
    mkdirSync(dirname(cache), { recursive: true })
    // Partial entry (without libraries.json): never used, it gets replaced.
    if (!existsSync(join(cache, 'libraries.json'))) rmSync(cache, { recursive: true, force: true })
    try {
      renameSync(tmp, cache)
    } catch (err) {
      // Another process published the same cache in the meantime: we keep theirs.
      rmSync(tmp, { recursive: true, force: true })
      if (!existsSync(join(cache, 'libraries.json'))) throw err
      cached = true
    }
  }
  cloneDir(cache, target, safety)
  const db = openTestDb({ file: join(target, 'libraries/default/recolt.db') })
  const items = (db.prepare('SELECT count(*) n FROM items').get() as { n: number }).n
  const media = (db.prepare('SELECT count(*) n FROM item_media').get() as { n: number }).n
  db.close()
  return {
    userData: target,
    libraryDir: join(target, 'libraries/default'),
    items,
    media,
    videos: -1,
    ffmpeg: findFfmpeg() !== null,
    cached,
  }
}
