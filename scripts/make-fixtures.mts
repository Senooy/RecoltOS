/**
 * Bibliothèque de démonstration (`pnpm run fixtures`, `pnpm run dev:demo`, projets e2e / visual).
 *
 *   tsx --tsconfig tsconfig.node.json scripts/make-fixtures.mts --out <userData> [--if-missing]
 *       [--count 60] [--collections 6] [--no-cache] [--force]
 *
 * SÉCURITÉ : `--out` est supprimé avant d'être régénéré. `tests/helpers/safe-out.ts` refuse un dossier
 * non vide sans marqueur `.recolt-fixture`, `$HOME`, le dépôt, `Library` / `Application Support` /
 * la référence ; hors `<dépôt>/.tmp` et `os.tmpdir()`, `--force` est exigé.
 *
 * Fabrique un `userData` complet : `libraries.json` + `libraries/default/recolt.db` (schéma =
 * migrations de production `src/main/db/migrations/*.sql`, `user_version` posé comme `db/migrate.ts`)
 * + médias synthétiques minuscules (originaux, vignettes 800w, posters, avatars en cache local).
 * Données 100 % synthétiques (`tests/helpers/synthetic-items.ts`), aucune donnée réelle.
 *
 * Écart assumé avec « via le code de production » (QA §2.9) : l'ingestion (WP-10) et les repos (WP-02)
 * n'existent pas encore au moment de WP-01 ; les lignes sont insérées par SQL direct
 * (`tests/helpers/db.ts#seedSyntheticLibrary`) avec `shard()` de `src/shared/ids.ts`. WP-1F remplacera
 * l'insertion par l'ingestion réelle.
 *
 * Cache (QA §6.1) : `node_modules/.cache/recoltos-demo/<clé>/`, clé = hash de ce script, des helpers
 * de synthèse, des migrations, des versions de sharp et de ffmpeg, et des paramètres. La sortie est un
 * clone APFS (`cp -c`) de l'entrée de cache.
 */
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
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { shard } from '../src/shared/ids'
import { openTestDb, seedSyntheticLibrary, type TestDb } from '../tests/helpers/db'
import { assertSafeOutDir, markFixtureDir } from '../tests/helpers/safe-out'
import { findFfmpeg, makeImage, makeVideo } from '../tests/helpers/synthetic-media'
import {
  makeSyntheticLibrary,
  type SyntheticItem,
  type SyntheticLibrary,
} from '../tests/helpers/synthetic-items'

const ROOT = resolve(import.meta.dirname, '..')
const LONG_SIDE = 480
const THUMB_SIDE = 320

export interface DemoOptions {
  /** Nombre d'éléments vivants (60 pour la démo e2e, 408 pour la parité avec la bibliothèque réelle). */
  count?: number
  /** Nombre de collections conservées (les plus remplies). */
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

/** Clé d'avatar : sha1(lower(handle)) sur 16 hex (ARCHI §3.1). */
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
    'scripts/make-fixtures.mts',
    'tests/helpers/synthetic-items.ts',
    'tests/helpers/synthetic-media.ts',
    'tests/helpers/db.ts',
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

/** Réduit les dimensions pour que les fichiers restent minuscules (rapport conservé). */
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
        // Trois échantillons mp4 (portrait, paysage, carré) clonés pour toutes les autres vidéos.
        const orientation =
          m.width > m.height ? 'paysage' : m.width < m.height ? 'portrait' : 'carre'
        const dims = { paysage: [112, 64], portrait: [64, 112], carre: [80, 80] }[orientation] as [
          number,
          number,
        ]
        let sample = videoSamples.get(orientation)
        if (sample === undefined) {
          const file = join(sampleDir, `sample-${orientation}.mp4`)
          // Sans ffmpeg : fichier vide, poster seul (mode dégradé, PLAN §1.16).
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
    // Les avatars Instagram sont tous expirés dans la bibliothèque réelle : monogramme (PLAN §9.4).
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

/** Clone APFS quand c'est possible (`cp -c`), copie classique sinon. */
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
  // `build` et `cloneDir` suppriment `target` : contrôle AVANT toute écriture (cf. safe-out.ts).
  const target = assertSafeOutDir(out, safety)
  if (!useCache) return { ...(await build(target, opts)), cached: false }

  const cache = join(ROOT, 'node_modules/.cache/recoltos-demo', cacheKey(opts))
  let cached = true
  if (!existsSync(join(cache, 'libraries.json'))) {
    cached = false
    const tmp = `${cache}.building-${process.pid}`
    await build(tmp, opts)
    rmSync(cache, { recursive: true, force: true })
    mkdirSync(dirname(cache), { recursive: true })
    renameSync(tmp, cache)
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

/** Entier ≥ 0 d'une option numérique. Refus explicite (sortie 2) plutôt que `NaN` silencieux. */
function parseCount(flag: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const n = raw.trim() === '' ? Number.NaN : Number(raw)
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`--${flag} doit être un entier ≥ 0 (reçu « ${raw} »)`)
  return n
}

/** Analyse des options : une exception de `parseArgs` (option inconnue, valeur absente) devient une erreur d'usage. */
function parseOptions(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    options: {
      out: { type: 'string' },
      'if-missing': { type: 'boolean', default: false },
      count: { type: 'string' },
      collections: { type: 'string' },
      trashed: { type: 'string' },
      hidden: { type: 'string' },
      'no-cache': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
  })
}

async function main(argv: readonly string[]): Promise<number> {
  let values: ReturnType<typeof parseOptions>['values']
  try {
    ;({ values } = parseOptions(argv))
  } catch (e) {
    console.error(`fixtures : ${(e as Error).message}`)
    console.error(
      'usage : make-fixtures.mts --out <userData> [--if-missing] [--count N] [--collections N] [--no-cache] [--force]',
    )
    return 2
  }
  if (!values.out) {
    console.error(
      'usage : make-fixtures.mts --out <userData> [--if-missing] [--count N] [--collections N] [--no-cache] [--force]',
    )
    return 2
  }
  const out = resolve(values.out)
  if (values['if-missing'] && existsSync(join(out, 'libraries.json'))) {
    console.log(`fixtures : ${out} existe déjà (--if-missing)`)
    return 0
  }
  const t0 = Date.now()
  try {
    assertSafeOutDir(out, { force: values.force })
  } catch (e) {
    console.error(`fixtures : ${(e as Error).message}`)
    return 2
  }
  let counts: Parameters<typeof makeDemoLibrary>[1]
  try {
    counts = {
      count: parseCount('count', values.count),
      collections: parseCount('collections', values.collections),
      trashed: parseCount('trashed', values.trashed),
      hidden: parseCount('hidden', values.hidden),
    }
  } catch (e) {
    console.error(`fixtures : ${(e as Error).message}`)
    console.error(
      'usage : make-fixtures.mts --out <userData> [--if-missing] [--count N] [--collections N] [--no-cache] [--force]',
    )
    return 2
  }
  const res = await makeDemoLibrary(out, counts, !values['no-cache'], { force: values.force })
  console.log(
    `fixtures : ${res.items} éléments, ${res.media} médias${res.cached ? ' (cache)' : ''}${res.ffmpeg ? '' : ' (ffmpeg absent : vidéos sans fichier lisible)'} → ${out} en ${Date.now() - t0} ms`,
  )
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
