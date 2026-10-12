/**
 * Fake GatherOS library from `tests/fixtures/gatheros/seed.json` and
 * `legacy-schema.sql`: v17 DB in WAL, tags (sources, `__starter__`, `screenshot`), collections
 * (including a sub-collection and a synthetic cover), `dismissed_tweets`, tiny generated media,
 * `prefs.json` with a fake extension token and an optional `SingletonLock`. No real data.
 * No `import.meta` (loaded as CJS by Playwright).
 */
import Database from 'better-sqlite3'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { REPO_ROOT } from './paths'
import { makeVideo } from './synthetic-media'

export const FAKE_EXTENSION_TOKEN = 'FAKE-TOKEN-DO-NOT-USE'
/** Name of the token key in the old app's settings (never imported). */
export const TOKEN_KEY = 'extension' + 'Token'

export interface LegacySeed {
  userVersion: number
  saves: (Record<string, unknown> & {
    id: string
    kind: string
    source: string
    file_path: string
    tweet_meta: string | null
  })[]
}

export function loadSeed(): LegacySeed {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, 'tests/fixtures/gatheros/seed.json'), 'utf8'),
  ) as LegacySeed
}

export interface LegacyLibrary {
  /** "GatherOS" folder (equivalent of `~/Library/Application Support/GatherOS`). */
  root: string
  libDir: string
  dbPath: string
  saveIds: string[]
  starterId: string
  /** Synthetic seed ids by role. */
  ids: { trashedInCollection: string; hidden: string; carousel: string; tweetQuoted: string }
}

const STARTER_ID = '0f0f0f0f-0000-4000-8000-000000000001'
const COL = (n: number) => `c0000000-0000-4000-8000-00000000000${n}`

async function writeImageFile(path: string, ext: string): Promise<void> {
  const img = sharp({ create: { width: 4, height: 3, channels: 3, background: '#8899aa' } })
  const buf =
    ext === 'jpg' || ext === 'jpeg'
      ? await img.jpeg().toBuffer()
      : ext === 'png'
        ? await img.png().toBuffer()
        : await img.webp().toBuffer()
  writeFileSync(path, buf)
}

export async function makeLegacyLibrary(
  root: string,
  opts: { running?: { host: string; pid: number } } = {},
): Promise<LegacyLibrary> {
  const seed = loadSeed()
  const libDir = join(root, 'libraries', 'library_default')
  const images = join(libDir, 'images')
  const thumbs = join(libDir, 'thumbs')
  mkdirSync(images, { recursive: true })
  mkdirSync(thumbs, { recursive: true })
  writeFileSync(
    join(root, 'libraries.json'),
    JSON.stringify({
      version: 1,
      active: 'library_default',
      libraries: [{ id: 'library_default', name: 'Library', createdAt: 1 }],
    }),
  )
  writeFileSync(
    join(root, 'prefs.json'),
    JSON.stringify({
      theme: 'dark',
      defaultColumns: 5,
      [TOKEN_KEY]: FAKE_EXTENSION_TOKEN,
      videoMuted: true,
    }),
  )
  if (opts.running)
    symlinkSync(`${opts.running.host}-${opts.running.pid}`, join(root, 'SingletonLock'))

  const dbPath = join(libDir, 'moodmark.db')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(readFileSync(join(REPO_ROOT, 'tests/fixtures/gatheros/legacy-schema.sql'), 'utf8'))
  db.pragma(`user_version = ${seed.userVersion}`)

  const enc = (name: string) => `moodmark-file://local/${encodeURIComponent(join(images, name))}`
  const files = new Set<string>()
  const fix = (s: string) =>
    s.replace(/moodmark-file:\/\/local\/\{\{LIB\}\}\/images\/([^"]+)/g, (_m, name: string) => {
      files.add(name)
      return enc(name)
    })
  const cols = db
    .prepare('SELECT * FROM saves LIMIT 0')
    .columns()
    .map((c) => c.name)
  const insert = db.prepare(
    `INSERT INTO saves (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`,
  )
  const rows = [
    ...seed.saves,
    // Starter example shipped with GatherOS: excluded by default (already in the trash).
    {
      ...seed.saves[0]!,
      id: STARTER_ID,
      file_path: `{{LIB}}/images/${STARTER_ID}.webp`,
      thumb_path: `{{LIB}}/thumbs/${STARTER_ID}.jpg`,
      deleted_at: 1,
      tweet_meta: null,
      source_url: null,
    },
  ]
  for (const s of rows) {
    const row: Record<string, unknown> = {}
    for (const c of cols) row[c] = (s as Record<string, unknown>)[c] ?? null
    row.file_path = String(s.file_path).replace('{{LIB}}', libDir)
    row.thumb_path =
      typeof row.thumb_path === 'string' ? row.thumb_path.replace('{{LIB}}', libDir) : null
    row.tweet_meta = s.tweet_meta ? fix(s.tweet_meta) : null
    row.embedding = null
    row.preview_path = null
    row.meta = null
    insert.run(row)
    files.add(String(row.file_path).split('/').pop()!)
  }

  // Tags: sources (become chips), starter, screenshot (→ capture).
  const tag = db.prepare('INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)')
  const link = db.prepare('INSERT OR IGNORE INTO save_tags (save_id, tag_id) VALUES (?, ?)')
  const tagIds: Record<string, string> = {
    bookmark: 'a0000000-0000-4000-8000-000000000001',
    instagram: 'a0000000-0000-4000-8000-000000000002',
    cosmos: 'a0000000-0000-4000-8000-000000000003',
    __starter__: 'a0000000-0000-4000-8000-000000000004',
    screenshot: 'a0000000-0000-4000-8000-000000000005',
    abstract: 'a0000000-0000-4000-8000-000000000006',
  }
  for (const [name, id] of Object.entries(tagIds)) tag.run(id, name)
  for (const s of seed.saves) {
    const t = s.source === 'x' ? 'bookmark' : s.source
    if (tagIds[t]) link.run(s.id, tagIds[t])
  }
  link.run(STARTER_ID, tagIds.__starter__)
  link.run(STARTER_ID, tagIds.abstract)

  const byRole = {
    tweetQuoted: seed.saves[0]!.id,
    carousel: seed.saves[5]!.id,
    trashedInCollection: seed.saves[8]!.id,
    hidden: seed.saves[9]!.id,
  }
  // Collections: 3 anonymized "real" ones + one sub-collection + one synthetic cover.
  const col = db.prepare(
    'INSERT INTO collections (id, name, color, created_at, order_index, parent_id, cover_save_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  col.run(COL(1), 'Collection 1', '#007aff', 1_700_000_000_000, 0, null, null)
  col.run(COL(2), 'Collection 2', '#007aff', 1_700_000_000_001, 1, null, byRole.carousel)
  col.run(COL(3), 'Collection 3', '#007aff', 1_700_000_000_002, 2, null, null)
  col.run(COL(4), 'Sous-collection 4', '#ff9500', 1_700_000_000_003, 0, COL(1), null)
  const ci = db.prepare(
    'INSERT INTO collection_items (collection_id, save_id, added_at) VALUES (?, ?, ?)',
  )
  seed.saves.slice(0, 4).forEach((s, i) => ci.run(COL(1), s.id, 1_700_000_100_000 + i))
  ci.run(COL(2), byRole.carousel, 1_700_000_200_000)
  ci.run(COL(2), seed.saves[0]!.id, 1_700_000_200_001)
  ci.run(COL(3), byRole.trashedInCollection, 1_700_000_300_000) // synthetic case
  ci.run(COL(4), byRole.hidden, 1_700_000_400_000)
  ci.run(COL(1), STARTER_ID, 1_700_000_500_000)

  db.prepare('INSERT INTO dismissed_tweets (tweet_key, dismissed_at) VALUES (?, ?)').run(
    'ig:CodeDismissed1',
    1_700_000_000_000,
  )
  db.prepare('INSERT INTO dismissed_tweets (tweet_key, dismissed_at) VALUES (?, ?)').run(
    '123456789',
    1_700_000_000_001,
  )
  db.close()

  for (const name of files) {
    const ext = name.split('.').pop()!.toLowerCase()
    const p = join(images, name)
    if (ext === 'mp4') {
      if (!makeVideo(p, { seconds: 1, width: 32, height: 32 })) writeFileSync(p, Buffer.alloc(64))
    } else await writeImageFile(p, ext)
  }
  for (const s of rows) await writeImageFile(join(thumbs, `${s.id}.jpg`), 'jpg')

  return {
    root,
    libDir,
    dbPath,
    saveIds: seed.saves.map((s) => s.id),
    starterId: STARTER_ID,
    ids: byRole,
  }
}
