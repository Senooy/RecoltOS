/**
 * Banc de performance (ARCHI §8, PLAN §8) : 10 000 éléments synthétiques par défaut.
 *
 *   tsx --tsconfig tsconfig.node.json scripts/seed-bench.mts --out <userData> [--count 10000] [--no-files]
 *
 * Même `userData` que `make-fixtures.mts` (libraries.json + libraries/default/recolt.db), mais les
 * fichiers sont des CLONES APFS (`COPYFILE_FICLONE`) de 50 échantillons : presque aucun octet écrit.
 * Distribution = celle de la bibliothèque réelle (408 éléments, `tests/helpers/synthetic-items.ts`),
 * mise à l'échelle. WP-71 l'étend (mesures et scénarios de perf).
 * Note : WP-71 cite `scripts/seed-bench.ts` ; le fichier livré est `seed-bench.mts` (tsx, tsconfig.node).
 */
import { copyFileSync, constants, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { shard } from '../src/shared/ids'
import { openTestDb, seedSyntheticLibrary } from '../tests/helpers/db'
import { makeImage, makeVideo } from '../tests/helpers/synthetic-media'
import { makeSyntheticLibrary } from '../tests/helpers/synthetic-items'

const SAMPLES = 50

export interface SeedBenchResult {
  userData: string
  items: number
  media: number
  files: number
  ms: { db: number; files: number }
}

function clone(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to, constants.COPYFILE_FICLONE)
}

export async function seedBench(
  out: string,
  options: { count?: number; files?: boolean } = {},
): Promise<SeedBenchResult> {
  const count = options.count ?? 10_000
  const withFiles = options.files ?? true
  const userData = resolve(out)
  rmSync(userData, { recursive: true, force: true })
  const libraryDir = join(userData, 'libraries', 'default')
  mkdirSync(libraryDir, { recursive: true })

  const t0 = Date.now()
  const lib = makeSyntheticLibrary({ count, seed: 10_000 })
  const db = openTestDb({ file: join(libraryDir, 'recolt.db') })
  db.pragma('synchronous = OFF')
  seedSyntheticLibrary(db, lib, { withDerived: withFiles })
  db.exec('ANALYZE')
  db.pragma('wal_checkpoint(TRUNCATE)')
  const media = (db.prepare('SELECT count(*) n FROM item_media').get() as { n: number }).n
  db.close()
  const tDb = Date.now() - t0

  let files = 0
  const t1 = Date.now()
  if (withFiles) {
    const samples = join(userData, 'tmp', 'samples')
    mkdirSync(samples, { recursive: true })
    const webp: string[] = []
    for (let i = 0; i < SAMPLES; i++) {
      const f = join(samples, `s${i}.webp`)
      writeFileSync(
        f,
        await makeImage({
          width: 320,
          height: 240,
          color: `#${(((i * 5) % 200) + 30).toString(16).padStart(2, '0')}8060`,
          to: '#f0e6d2',
        }),
      )
      webp.push(f)
    }
    const jpg = join(samples, 'poster.jpg')
    writeFileSync(jpg, await makeImage({ width: 320, height: 240, format: 'jpeg' }))
    const mp4 = join(samples, 'video.mp4')
    const hasVideo = makeVideo(mp4)
    for (const it of lib.items) {
      for (const m of it.media) {
        const ab = shard(m.uuid)
        clone(
          webp[(it.index + m.position) % SAMPLES] as string,
          join(libraryDir, `thumbs/${ab}/${m.uuid}.webp`),
        )
        files += 1
        if (m.mediaType === 'video') {
          clone(jpg, join(libraryDir, `posters/${ab}/${m.uuid}.jpg`))
          if (hasVideo) clone(mp4, join(libraryDir, `items/${ab}/${m.uuid}.mp4`))
          files += hasVideo ? 2 : 1
        } else {
          clone(
            webp[(it.index + m.position) % SAMPLES] as string,
            join(libraryDir, `items/${ab}/${m.uuid}.webp`),
          )
          files += 1
        }
      }
    }
    rmSync(join(userData, 'tmp'), { recursive: true, force: true })
  }
  writeFileSync(
    join(userData, 'libraries.json'),
    JSON.stringify(
      {
        version: 1,
        active: 'default',
        libraries: [{ id: 'default', name: 'Banc', path: null, createdAt: 1_791_700_000_000 }],
      },
      null,
      2,
    ) + '\n',
  )
  return {
    userData,
    items: lib.items.length,
    media,
    files,
    ms: { db: tDb, files: Date.now() - t1 },
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      out: { type: 'string' },
      count: { type: 'string' },
      'no-files': { type: 'boolean', default: false },
    },
  })
  if (!values.out) {
    console.error('usage : seed-bench.mts --out <userData> [--count 10000] [--no-files]')
    return 2
  }
  const res = await seedBench(values.out, {
    count: values.count ? Number(values.count) : undefined,
    files: !values['no-files'],
  })
  console.log(
    `seed-bench : ${res.items} éléments, ${res.media} médias, ${res.files} fichiers (clones) → ${res.userData} (base ${res.ms.db} ms, fichiers ${res.ms.files} ms)`,
  )
  return existsSync(join(res.userData, 'libraries.json')) ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
