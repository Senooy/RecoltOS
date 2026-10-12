/**
 * Tags IA : normalisation, mots vides, vocabulaire contrôlé, correspondance EN → FR.
 * Les tags de source (`x`, `instagram`, `cosmos`, `bookmark`) sont des chips virtuelles :
 * ils restent dans `STOP` pour que l'IA ne les produise pas.
 */
import type Database from 'better-sqlite3'
import { isReservedTagName } from '../db/repos/tags'

export const normalizeTag = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '')

export const STOP: ReadonlySet<string> = new Set([
  'image',
  'photo',
  'visuel',
  'contenu',
  'post',
  'tweet',
  'video',
  'instagram',
  'x',
  'cosmos',
  'bookmark',
  'picture',
  'screenshot',
  'twitter',
  'reel',
])

export const SEED_TAGS: readonly string[] = [
  'affiche',
  'typographie',
  'interface',
  'mobile',
  'site-web',
  'illustration',
  'photographie',
  'portrait',
  'architecture',
  'packaging',
  'logo',
  'branding',
  '3d',
  'motion-design',
  'pixel-art',
  'jeu-video',
  'manga',
  'bande-dessinee',
  'mode',
  'produit',
  'nature',
  'minimaliste',
  'retro',
  'sombre',
  'colore',
  'abstrait',
  'meme',
  'capture-ecran',
  'code',
  'ia-generative',
  'texture',
  'dessin',
  'peinture',
  'cinema',
  'musique',
  'nourriture',
  'voiture',
  'paysage',
  'schema',
  'citation',
  'design-graphique',
  'art-numerique',
]

/** Tags importés anglais → français ; ne s'applique qu'aux tags importés. */
export const TAG_MAP_EN_FR: Readonly<Record<string, string>> = {
  typography: 'typographie',
  branding: 'branding',
  sleek: 'epure',
  minimalist: 'minimaliste',
  divine: 'celeste',
  heavenly: 'celeste',
  food: 'nourriture',
  'digital-art': 'art-numerique',
  artistic: 'artistique',
  abstract: 'abstrait',
  modern: 'moderne',
  'graphic-design': 'design-graphique',
  'event-poster': 'affiche',
  bitcoin: 'bitcoin',
  vibrant: 'colore',
  screenshot: 'capture-ecran',
}

export const VOCABULARY_MAX = 60
export const MAX_TAGS = 6
export const MAX_NEW_TAGS = 2

/** `SEED_TAGS` ∪ 40 tags les plus utilisés (hors noms réservés), 60 au plus. */
export function buildVocabulary(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT t.name AS name, count(*) AS n FROM item_tags it JOIN tags t ON t.id = it.tag_id
       GROUP BY t.id ORDER BY n DESC, t.name LIMIT 80`,
    )
    .all() as { name: string; n: number }[]
  const out: string[] = [...SEED_TAGS]
  const seen = new Set(out)
  let added = 0
  for (const r of rows) {
    if (added >= 40 || out.length >= VOCABULARY_MAX) break
    const n = normalizeTag(r.name)
    if (!n || seen.has(n) || STOP.has(n) || isReservedTagName(n) || n.startsWith('__')) continue
    seen.add(n)
    out.push(n)
    added++
  }
  return out.slice(0, VOCABULARY_MAX)
}

/**
 * Filtre la proposition du modèle : normalisée, dédoublonnée, sans mots vides ni noms réservés,
 * au plus `MAX_NEW_TAGS` hors vocabulaire (les suivants sont éliminés), `MAX_TAGS` au total.
 */
export function filterTags(raw: readonly string[], vocabulary: readonly string[]): string[] {
  const vocab = new Set(vocabulary.map(normalizeTag))
  const out: string[] = []
  let fresh = 0
  for (const r of raw) {
    if (typeof r !== 'string') continue
    const t = normalizeTag(r)
    if (!t || STOP.has(t) || isReservedTagName(t) || out.includes(t)) continue
    if (!vocab.has(t)) {
      if (fresh >= MAX_NEW_TAGS) continue
      fresh++
    }
    out.push(t)
    if (out.length >= MAX_TAGS) break
  }
  return out
}
