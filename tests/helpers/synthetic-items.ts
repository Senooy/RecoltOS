/**
 * Éléments synthétiques déterministes (PRNG à graine) : AUCUNE donnée réelle, que des chaînes
 * inventées et des URL `https://example.test/…`. Sans dépendance à vitest, au DOM ni à Electron :
 * importé à la fois par les tests (tsconfig.tests) et par les scripts (`make-fixtures.mts`,
 * `seed-bench.mts`, tsconfig.node).
 *
 * Répartition de référence : 408 éléments vivants
 *   vidéo/instagram 141, image/x 76, vidéo/x 68, tweet/x 54 (les « posts texte »), image/instagram 38,
 *   image/cosmos 29, url/x 2 ; 17 collections (252 appartenances, 250 éléments distincts).
 * étend ce fichier (volumes, états). Les 10 000 éléments du banc de perf = `count: 10_000`.
 */
import { hexToLab, labToLch, rgbToHex, hueBucket, type Lab } from '../../src/shared/color'

export type SyntheticKind = 'image' | 'video' | 'tweet' | 'url'
export type SyntheticSource = 'x' | 'instagram' | 'cosmos'

export interface SyntheticPostMedia {
  type: 'image' | 'video'
  remoteUrl: string | null
  posterUrl: string | null
  mediaUuid: string | null
}

export interface SyntheticAuthorRef {
  name: string | null
  handle: string | null
  avatarUrl: string | null
}

/** Forme `PostMetaSchema` v1 (src/shared/post-meta.ts), construite à la main pour rester sans dépendance. */
export interface SyntheticPostMeta {
  v: 1
  platform: 'x' | 'instagram' | 'cosmos' | 'web'
  author: SyntheticAuthorRef | null
  text: string | null
  url: string | null
  postedAt: number | null
  media: SyntheticPostMedia[]
  quoted: {
    author: SyntheticAuthorRef | null
    text: string | null
    url: string | null
    media: SyntheticPostMedia[]
  } | null
  thread: { text: string; media: SyntheticPostMedia[] }[]
}

export interface SyntheticMedia {
  uuid: string
  position: number
  mediaType: 'image' | 'video'
  width: number
  height: number
  mime: string
  ext: string
  durationMs: number | null
}

export interface SyntheticItem {
  /** Rang dans la bibliothèque (0 = le plus récent). */
  index: number
  uuid: string
  kind: SyntheticKind
  source: SyntheticSource
  externalId: string
  sourceUrl: string
  title: string | null
  notes: string | null
  /** Dimensions du média principal ; `null` pour les posts texte et les liens. */
  width: number | null
  height: number | null
  mime: string | null
  durationMs: number | null
  media: SyntheticMedia[]
  createdAt: number
  palette: string[] | null
  paletteLab: Lab[] | null
  colorL: number | null
  colorC: number | null
  colorH: number | null
  colorBucket: number
  author: { platform: SyntheticSource; handle: string; name: string } | null
  postMeta: SyntheticPostMeta | null
  trashedAt: number | null
  hiddenAt: number | null
}

export interface SyntheticCollection {
  uuid: string
  name: string
  /** Indices (`SyntheticItem.index`) des membres. */
  itemIndexes: number[]
}

export interface SyntheticLibrary {
  items: SyntheticItem[]
  collections: SyntheticCollection[]
  tags: { uuid: string; name: string; itemIndexes: number[] }[]
}

export interface SyntheticOptions {
  seed?: number
  /** Nombre d'éléments vivants (408 par défaut). */
  count?: number
  /** Éléments supplémentaires en corbeille / masqués (0 par défaut ; 9 et 1 sur la photo réelle). */
  trashed?: number
  hidden?: number
  /** Horloge injectée (ms epoch) : borne haute des dates de création. */
  now?: number
}

/** Photo de référence : le total vaut 408. */
export const REFERENCE_DISTRIBUTION: readonly {
  kind: SyntheticKind
  source: SyntheticSource
  n: number
}[] = [
  { kind: 'video', source: 'instagram', n: 141 },
  { kind: 'image', source: 'x', n: 76 },
  { kind: 'video', source: 'x', n: 68 },
  { kind: 'tweet', source: 'x', n: 54 },
  { kind: 'image', source: 'instagram', n: 38 },
  { kind: 'image', source: 'cosmos', n: 29 },
  { kind: 'url', source: 'x', n: 2 },
]
export const REFERENCE_COUNT = 408

/** Collections de la bibliothèque synthétique (noms génériques). */
export const REFERENCE_COLLECTIONS: readonly { name: string; n: number }[] = [
  { name: 'Jeux vidéo', n: 36 },
  { name: 'Graphisme', n: 32 },
  { name: 'Sport', n: 18 },
  { name: 'Photo et vidéo', n: 25 },
  { name: 'Médias', n: 13 },
  { name: 'Business', n: 13 },
  { name: 'Bien-être', n: 3 },
  { name: 'Développement', n: 60 },
  { name: 'Famille', n: 6 },
  { name: 'Quartier', n: 1 },
  { name: 'Voyages', n: 3 },
  { name: 'Objets', n: 5 },
  { name: 'Spiritualité', n: 6 },
  { name: 'Intérieur', n: 1 },
  { name: 'Cuisine', n: 6 },
  { name: 'Planches', n: 22 },
  { name: 'Humour', n: 2 },
]

/** Fenêtre de dates de la photo : 2026-06-30 → 2026-09-24. */
export const DEFAULT_NOW = Date.UTC(2026, 8, 24, 21, 0, 0)
const DEFAULT_START = Date.UTC(2026, 5, 30, 8, 0, 0)

// ---------------------------------------------------------------------------------------------
// PRNG

export type Rng = () => number

/** mulberry32 : déterministe, 32 bits. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const int = (rng: Rng, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1))
const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)] as T

/** UUID de forme v4 tiré du PRNG (déterministe). */
export function seededUuid(rng: Rng): string {
  const h = (n: number) =>
    Array.from({ length: n }, () => Math.floor(rng() * 16).toString(16)).join('')
  return `${h(8)}-${h(4)}-4${h(3)}-${'89ab'[Math.floor(rng() * 4)] ?? '8'}${h(3)}-${h(12)}`
}

// ---------------------------------------------------------------------------------------------
// Contenus inventés

const WORDS = [
  'lumière',
  'atelier',
  'palette',
  'horizon',
  'carnet',
  'trame',
  'relief',
  'sillage',
  'verger',
  'récolte',
  'mosaïque',
  'ardoise',
  'brume',
  'crayon',
  'étagère',
  'cadrage',
  'texture',
  'sérigraphie',
  'poster',
  'maquette',
  'ruban',
  'galet',
  'prisme',
  'gabarit',
  'calepin',
]
const FIRST = ['Alix', 'Noé', 'Jade', 'Milo', 'Inès', 'Léon', 'Zoé', 'Hugo', 'Lina', 'Oscar']
const LAST = ['Marchand', 'Dupin', 'Rivière', 'Vasseur', 'Colin', 'Lacour', 'Masson', 'Perrot']
const SENTENCES = [
  'Petit rappel : un bon cadrage vaut mieux que dix filtres.',
  'Je note ça ici pour plus tard, la composition est vraiment propre.',
  'Thread sur la mise en page des carnets de croquis, de A à Z.',
  'Nouvelle version disponible, avec un rendu bien plus fidèle.',
  'Trois idées de palettes pour un projet d’automne.',
  'Ce détail de typographie change tout dans la lecture.',
  'Mon outil préféré du moment, simple et rapide.',
  'Avant et après : même scène, autre lumière.',
]

function words(rng: Rng, n: number): string {
  return Array.from({ length: n }, () => pick(rng, WORDS)).join(' ')
}
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

function randomHex(rng: Rng): string {
  const h = rng() * 360
  const s = 0.25 + rng() * 0.6
  const l = 0.25 + rng() * 0.5
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255])
}

function makePalette(rng: Rng): { hexes: string[]; labs: Lab[] } {
  const n = int(rng, 3, 8)
  const hexes = Array.from({ length: n }, () => randomHex(rng))
  return { hexes, labs: hexes.map((h) => hexToLab(h)) }
}

/** Plus grand reste : répartit `total` selon les poids, somme exacte. */
export function scaleCounts(weights: readonly number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  const raw = weights.map((w) => (w / sum) * total)
  const out = raw.map(Math.floor)
  let rest = total - out.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac)
  for (const { i } of order) {
    if (rest <= 0) break
    out[i] = (out[i] ?? 0) + 1
    rest -= 1
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Génération

const RATIOS: readonly [number, number][] = [
  [4, 5],
  [1, 1],
  [3, 4],
  [9, 16],
  [16, 9],
  [2, 3],
  [3, 2],
]

function makeAuthor(
  rng: Rng,
  platform: SyntheticSource,
  pool: number,
): { platform: SyntheticSource; handle: string; name: string } {
  const n = int(rng, 1, pool)
  const first = FIRST[n % FIRST.length] ?? 'Alix'
  const last = LAST[Math.floor(n / FIRST.length) % LAST.length] ?? 'Colin'
  return { platform, handle: `auteur_${String(n).padStart(3, '0')}`, name: `${first} ${last}` }
}

function authorRef(a: { handle: string; name: string }): SyntheticAuthorRef {
  return {
    name: a.name,
    handle: a.handle,
    avatarUrl: `https://example.test/avatar/${a.handle}.jpg`,
  }
}

export function makeSyntheticLibrary(options: SyntheticOptions = {}): SyntheticLibrary {
  const seed = options.seed ?? 20260924
  const count = options.count ?? REFERENCE_COUNT
  const now = options.now ?? DEFAULT_NOW
  const extraTrashed = options.trashed ?? 0
  const extraHidden = options.hidden ?? 0
  const rng = makeRng(seed)

  // 1. Quotas par (kind, source), puis mélange des positions.
  const quotas = scaleCounts(
    REFERENCE_DISTRIBUTION.map((d) => d.n),
    count,
  )
  const slots: { kind: SyntheticKind; source: SyntheticSource }[] = []
  REFERENCE_DISTRIBUTION.forEach((d, i) => {
    for (let k = 0; k < (quotas[i] ?? 0); k++) slots.push({ kind: d.kind, source: d.source })
  })
  const total = count + extraTrashed + extraHidden
  while (slots.length < total) {
    const d = pick(rng, REFERENCE_DISTRIBUTION.slice(0, 2))
    slots.push({ kind: d.kind, source: d.source })
  }
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const a = slots[i] as (typeof slots)[number]
    slots[i] = slots[j] as (typeof slots)[number]
    slots[j] = a
  }

  // 2. Dates décroissantes (index 0 = plus récent), espacement irrégulier.
  const span = Math.max(1, now - DEFAULT_START)
  const items: SyntheticItem[] = slots.map((slot, index) => {
    const createdAt = Math.round(
      now - (index / Math.max(1, total - 1)) * span + (rng() - 0.5) * (span / total) * 0.6,
    )
    const uuid = seededUuid(rng)
    const author =
      slot.source === 'cosmos' || slot.kind === 'url' ? null : makeAuthor(rng, slot.source, 60)
    const ratio = pick(rng, RATIOS)
    const scale = int(rng, 6, 20) * 100
    const isMedia = slot.kind === 'image' || slot.kind === 'video'
    const width = isMedia ? Math.round((ratio[0] / Math.max(ratio[0], ratio[1])) * scale) : null
    const height = isMedia ? Math.round((ratio[1] / Math.max(ratio[0], ratio[1])) * scale) : null
    const carousel =
      slot.source === 'instagram' && slot.kind === 'image' && rng() < 0.25 ? int(rng, 2, 6) : 1
    const media: SyntheticMedia[] = isMedia
      ? Array.from({ length: carousel }, (_, position) => ({
          uuid: seededUuid(rng),
          position,
          mediaType: slot.kind === 'video' ? ('video' as const) : ('image' as const),
          width: width as number,
          height: height as number,
          mime: slot.kind === 'video' ? 'video/mp4' : 'image/webp',
          ext: slot.kind === 'video' ? 'mp4' : 'webp',
          durationMs: slot.kind === 'video' ? int(rng, 3, 90) * 1000 : null,
        }))
      : []

    // Palette : toutes les images et tous les posts ; les vidéos n'en ont pas avant media.derive.
    const hasPalette = slot.kind !== 'video' && slot.kind !== 'url'
    const pal = hasPalette ? makePalette(rng) : null
    const lch = pal?.labs[0] ? labToLch(pal.labs[0]) : null

    const titled = rng() < 0.7
    const title = titled
      ? slot.kind === 'tweet'
        ? null
        : capitalize(words(rng, int(rng, 2, 4)))
      : null
    const externalId = String(1_700_000_000_000 + index * 977 + int(rng, 0, 900))
    const platform = slot.source
    const sourceUrl =
      slot.kind === 'url'
        ? `https://example.test/lien/${index}`
        : platform === 'instagram'
          ? `https://example.test/instagram/p/${externalId}`
          : platform === 'cosmos'
            ? `https://example.test/cosmos/${externalId}`
            : `https://example.test/x/${author?.handle ?? 'anon'}/status/${externalId}`

    let postMeta: SyntheticPostMeta | null = null
    if (author && slot.kind !== 'url') {
      const text =
        slot.kind === 'tweet'
          ? `${pick(rng, SENTENCES)} ${rng() < 0.5 ? words(rng, int(rng, 6, 22)) : ''}`.trim()
          : rng() < 0.6
            ? pick(rng, SENTENCES)
            : null
      const quotedAuthor = rng() < 0.35 ? makeAuthor(rng, slot.source, 60) : null
      postMeta = {
        v: 1,
        platform,
        author: authorRef(author),
        text,
        url: sourceUrl,
        postedAt: createdAt - int(rng, 1, 40) * 3_600_000,
        media: media.map((m) => ({
          type: m.mediaType,
          remoteUrl: `https://example.test/media/${m.uuid}.${m.ext}`,
          posterUrl: m.mediaType === 'video' ? `https://example.test/media/${m.uuid}.jpg` : null,
          mediaUuid: m.uuid,
        })),
        quoted: quotedAuthor
          ? {
              author: authorRef(quotedAuthor),
              text: pick(rng, SENTENCES),
              url: `https://example.test/x/${quotedAuthor.handle}/status/${externalId}1`,
              media: [],
            }
          : null,
        thread:
          slot.kind === 'tweet' && rng() < 0.11
            ? Array.from({ length: int(rng, 1, 3) }, () => ({
                text: `${pick(rng, SENTENCES)} ${words(rng, 5)}`,
                media: [],
              }))
            : [],
      }
    }

    return {
      index,
      uuid,
      kind: slot.kind,
      source: slot.source,
      externalId,
      sourceUrl,
      title,
      notes: rng() < 0.06 ? `Note ${index} : ${words(rng, 5)}.` : null,
      width,
      height,
      mime: isMedia ? (media[0]?.mime ?? null) : null,
      durationMs: media[0]?.durationMs ?? null,
      media,
      createdAt,
      palette: pal?.hexes ?? null,
      paletteLab: pal?.labs ?? null,
      colorL: lch ? lch[0] : null,
      colorC: lch ? lch[1] : null,
      colorH: lch ? lch[2] : null,
      colorBucket: hueBucket(lch),
      author,
      postMeta,
      trashedAt: null,
      hiddenAt: null,
    }
  })

  // 3. Les derniers éléments tirés deviennent corbeille puis masqués (jamais en collection).
  const liveCount = count
  for (let k = 0; k < extraTrashed; k++) {
    const it = items[liveCount + k]
    if (it) it.trashedAt = now - (k + 1) * 3_600_000
  }
  for (let k = 0; k < extraHidden; k++) {
    const it = items[liveCount + extraTrashed + k]
    if (it) it.hiddenAt = now - (k + 1) * 7_200_000
  }

  // 4. Collections : mêmes proportions que la photo (252 appartenances pour 250 éléments distincts à 408).
  const collectionSizes = scaleCounts(
    REFERENCE_COLLECTIONS.map((c) => c.n),
    Math.round((252 * count) / REFERENCE_COUNT),
  )
  const distinct = Math.min(liveCount, Math.round((250 * count) / REFERENCE_COUNT))
  const order = Array.from({ length: liveCount }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const a = order[i] as number
    order[i] = order[j] as number
    order[j] = a
  }
  const members = order.slice(0, distinct)
  let cursor = 0
  const collections: SyntheticCollection[] = REFERENCE_COLLECTIONS.map((c, ci) => {
    const size = Math.min(collectionSizes[ci] ?? 0, Math.max(distinct, 1))
    const itemIndexes: number[] = []
    for (let k = 0; k < size; k++) {
      itemIndexes.push(members[cursor % Math.max(1, members.length)] as number)
      cursor += 1
    }
    return { uuid: seededUuid(rng), name: c.name, itemIndexes: [...new Set(itemIndexes)] }
  })

  // 5. Quelques tags utilisateur.
  const tagNames = ['inspiration', 'à-lire', 'typographie', 'référence', 'couleurs']
  const tags = tagNames.map((name) => ({
    uuid: seededUuid(rng),
    name,
    itemIndexes: Array.from(
      { length: Math.min(liveCount, Math.max(1, Math.round(liveCount * 0.08))) },
      () => int(rng, 0, Math.max(0, liveCount - 1)),
    ).filter((v, i, a) => a.indexOf(v) === i),
  }))

  return { items, collections, tags }
}

/** Les éléments vivants (ni corbeille ni masqués). */
export const liveItems = (lib: SyntheticLibrary): SyntheticItem[] =>
  lib.items.filter((i) => i.trashedAt === null && i.hiddenAt === null)

/** La bibliothèque de démonstration de 408 éléments (dont 54 posts texte). */
export function makeSyntheticItems(options: SyntheticOptions = {}): SyntheticItem[] {
  return makeSyntheticLibrary(options).items
}
