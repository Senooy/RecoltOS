/**
 * Fixture GatherOS anonymisée (QA §5.2) : `tsx scripts/extract-gatheros-fixture.mts --db <copie>`.
 * Lit une COPIE de `moodmark.db` en lecture seule, sélectionne 10 saves par prédicats, remplace TOUT
 * texte par des valeurs synthétiques déterministes (structure conservée : clés, longueurs de tableaux,
 * nature des URL `moodmark-file://` / http), puis écrit `tests/fixtures/gatheros/seed.json` et
 * `legacy-schema.sql`. Garde anti-fuite : échec si une chaîne de 8 caractères ou plus de la source
 * apparaît dans la sortie. Aucune base ni aucun média n'entre dans git.
 */
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const ROOT = join(import.meta.dirname, '..')
const OUT = join(ROOT, 'tests/fixtures/gatheros')

const { values } = parseArgs({ options: { db: { type: 'string' } } })
if (!values.db) {
  console.error('usage : extract-gatheros-fixture.mts --db <copie de moodmark.db>')
  process.exit(2)
}
if (/application support\/gatheros/i.test(values.db)) {
  console.error('refusé : passe une COPIE de la base, jamais le dossier GatherOS')
  process.exit(2)
}

const db = new Database(values.db, { readonly: true, fileMustExist: true })
type Row = Record<string, unknown> & { id: string }

const PREDICATES: [string, string][] = [
  ['tweet cité', "kind='tweet' AND json_type(tweet_meta,'$.quoted')='object'"],
  ['tweet en fil', "kind='tweet' AND json_array_length(tweet_meta,'$.thread') > 0"],
  ['image x', "kind='image' AND source='x' AND palette IS NOT NULL AND ai_description IS NOT NULL"],
  ['vidéo x', "kind='video' AND source='x'"],
  ['vidéo instagram', "kind='video' AND source='instagram'"],
  [
    'carrousel instagram',
    "source='instagram' AND json_array_length(tweet_meta,'$.media') > 1 AND tweet_meta LIKE '%moodmark-file%' AND tweet_meta LIKE '%\"poster\":\"moodmark-file%'",
  ],
  ['cosmos', "source='cosmos'"],
  ['url', "kind='url'"],
  [
    'corbeille',
    "deleted_at IS NOT NULL AND id NOT IN (SELECT save_id FROM save_tags st JOIN tags t ON t.id=st.tag_id WHERE t.name='__starter__')",
  ],
  ['masqué', 'hidden_at IS NOT NULL'],
]

const picked: Row[] = []
for (const [label, where] of PREDICATES) {
  const r = db
    .prepare(
      `SELECT * FROM saves WHERE ${where} AND id NOT IN (${picked.map(() => '?').join(',') || "''"}) ORDER BY created_at LIMIT 1`,
    )
    .get(...picked.map((p) => p.id)) as Row | undefined
  if (!r) throw new Error(`aucun save pour « ${label} »`)
  picked.push(r)
}

// --- Anonymisation déterministe -------------------------------------------------------------
const sources = new Set<string>()
const remember = (v: unknown) => {
  if (typeof v === 'string' && v.length >= 8) sources.add(v)
}
const idMap = new Map<string, string>()
const synthUuid = (seed: string): string => {
  let v = idMap.get(seed)
  if (!v) {
    const h = createHash('sha1').update(`fixture:${seed}`).digest('hex')
    v = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
    idMap.set(seed, v)
  }
  return v
}
let n = 0
const next = () => ++n
const text = () => `texte ${next()}`
const avatar = () => `https://example.test/avatar_${next()}.jpg`
const media = (u: unknown): unknown => {
  remember(u)
  if (typeof u !== 'string' || !u) return u
  if (u.startsWith('moodmark-file://local/')) {
    const ext = /\.([a-z0-9]+)$/i.exec(decodeURIComponent(u))?.[1] ?? 'jpg'
    return `moodmark-file://local/{{LIB}}/images/${synthUuid(u)}.${ext}`
  }
  return `https://example.test/media_${next()}.jpg`
}

function anonTweetMeta(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  let tm: Record<string, unknown>
  try {
    tm = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  const k = next()
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(tm)) {
    const v = tm[key]
    remember(v)
    switch (key) {
      case 'authorName':
        out[key] = v ? `author_${k}` : v
        break
      case 'authorHandle':
        out[key] = v ? `@handle_${k}` : v
        break
      case 'authorAvatarUrl':
        out[key] = v ? avatar() : v
        break
      case 'caption':
        out[key] = v ? text() : v
        break
      case 'media':
        out[key] = Array.isArray(v)
          ? v.map((m: Record<string, unknown>) => ({
              type: m.type,
              url: media(m.url),
              ...(m.poster !== undefined ? { poster: media(m.poster) } : {}),
            }))
          : v
        break
      case 'imageUrls':
        out[key] = Array.isArray(v) ? v.map((u) => media(u)) : v
        break
      case 'videoUrl':
      case 'posterUrl':
        out[key] = v ? media(v) : v
        break
      case 'quoted': {
        const q = v as Record<string, unknown> | null
        out[key] = q
          ? {
              authorName: q.authorName ? `author_q${k}` : q.authorName,
              authorHandle: q.authorHandle ? `@handle_q${k}` : q.authorHandle,
              authorAvatarUrl: q.authorAvatarUrl ? avatar() : q.authorAvatarUrl,
              caption: q.caption ? text() : q.caption,
              imageUrls: Array.isArray(q.imageUrls) ? q.imageUrls.map((u) => media(u)) : [],
            }
          : q
        for (const x of Object.values(q ?? {})) remember(x)
        break
      }
      case 'thread':
        out[key] = Array.isArray(v)
          ? v.map((t: Record<string, unknown>) => {
              remember(t.text)
              return {
                text: text(),
                imageUrls: Array.isArray(t.imageUrls) ? t.imageUrls.map((u) => media(u)) : [],
              }
            })
          : v
        break
      default:
        out[key] = null
    }
  }
  return JSON.stringify(out)
}

/** URL source synthétique qui garde la forme utile à l'importeur (identifiant externe, hôte). */
function synthSourceUrl(source: string, kind: string, i: number): string {
  if (kind === 'url') return `https://www.example.test/page/${i}`
  if (source === 'instagram') return `https://www.instagram.com/p/code${i}/`
  if (source === 'cosmos') return `https://www.cosmos.so/e/${5000 + i}`
  return `https://x.com/handle_${i}/status/${1000000 + i}`
}

const seedSaves = picked.map((s, i) => {
  for (const v of Object.values(s)) remember(v)
  const ext = /\.([a-z0-9]+)$/i.exec(String(s.file_path))?.[1] ?? 'webp'
  const id = synthUuid(s.id)
  return {
    id,
    file_path: `{{LIB}}/images/${id}.${ext}`,
    thumb_path: `{{LIB}}/thumbs/${id}.jpg`,
    title: s.title ? `Titre ${i + 1}` : null,
    source_url: s.source_url ? synthSourceUrl(String(s.source), String(s.kind), i + 1) : null,
    width: s.width,
    height: s.height,
    file_size: s.file_size,
    palette: s.palette,
    palette_lab: s.palette_lab,
    created_at: s.created_at,
    ai_description: s.ai_description ? `description ${i + 1}` : null,
    ocr_text: s.ocr_text ? `ocr ${i + 1}` : s.ocr_text === '' ? '' : null,
    ai_prompt: s.ai_prompt ? `prompt ${i + 1}` : null,
    deleted_at: s.deleted_at,
    hidden_at: s.hidden_at,
    notes: s.notes ? `note ${i + 1}` : null,
    content_hash: s.content_hash ? createHash('sha256').update(`h${i}`).digest('hex') : null,
    kind: s.kind,
    tweet_meta: anonTweetMeta(s.tweet_meta),
    source: s.source,
    view_count: s.view_count,
    viewed_at: s.viewed_at,
  }
})

// Palettes : couleurs (non identifiantes) conservées telles quelles.
const seed = {
  doc: 'Fixture GatherOS anonymisée (QA §5.2), générée par scripts/extract-gatheros-fixture.mts. Aucune donnée réelle.',
  userVersion: Number(db.pragma('user_version', { simple: true })),
  saves: seedSaves,
}
const order = { table: 0, view: 1, index: 2, trigger: 3 } as Record<string, number>
const schema = (
  db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { type: string; name: string; sql: string }[]
)
  // Tables fantômes de FTS5 : recréées par `CREATE VIRTUAL TABLE`.
  .filter((r) => !/_fts_(data|idx|content|docsize|config)$/.test(r.name))
  .sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9) || a.name.localeCompare(b.name))
  .map((r) => `${r.sql};`)
  .join('\n')
db.close()

const json = JSON.stringify(seed, null, 2)
const ENUMS = new Set(['instagram', 'cosmos', 'x', 'image', 'video', 'tweet', 'url'])
const leaks = [...sources].filter(
  (s) =>
    s.length >= 8 &&
    !ENUMS.has(s) &&
    !/^\d+$/.test(s) &&
    !/^#[0-9a-f]{6}$/i.test(s) &&
    !s.startsWith('[') &&
    json.includes(s),
)
if (leaks.length > 0) {
  console.error(
    `fuite détectée (${leaks.length} chaîne(s) de la source dans seed.json) : génération annulée`,
  )
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'seed.json'), `${json}\n`)
writeFileSync(join(OUT, 'legacy-schema.sql'), `${schema}\n`)
console.log(`seed.json : ${seedSaves.length} saves`)
