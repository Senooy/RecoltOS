/**
 * Requête de recherche (ARCHI §4.5 `search/fts-query`, DESIGN §3.5) : texte saisi → expression FTS5 +
 * filtres. Partagé : main l’exécute, le renderer s’en sert pour convertir la syntaxe en chips.
 *  - mots nus → `"mot"*` (ET implicite, guillemets doublés) ; `"une phrase"` → `"une phrase"` ;
 *  - `#x #instagram #cosmos` (et l'alias `#bookmark` → `x`) → filtre `sources`, pas un terme FTS ;
 *  - autres `#tag` → `tags:"tag"*` (+ nom gardé pour la chip) ; `@handle` → `post_text:"handle"` ;
 *  - `type:video|image|post|page` (et `tweet`, `url`), `source:x`, `couleur:#ff3b30` → filtres ;
 *  - un mot nu égal à une source (`instagram`, `cosmos`, `twitter`) est noté dans `sourceWords` :
 *    la recherche met les éléments de cette source en tête, puis les résultats plein texte.
 * Pur (sans base) : testable.
 */
import type { ItemKind, Source } from './enums'

export interface ParsedQuery {
  /** Expression FTS5, `null` si aucun terme plein texte. */
  match: string | null
  sources: Source[]
  kinds: ItemKind[]
  tags: string[]
  handles: string[]
  color: string | null
  sourceWords: Source[]
  /** Termes nus (pour la surbrillance, l'historique). */
  terms: string[]
}

const SOURCE_TAGS: Record<string, Source> = {
  x: 'x',
  bookmark: 'x',
  twitter: 'x',
  instagram: 'instagram',
  cosmos: 'cosmos',
}

/** Mots nus qui désignent une source (union du filtre de source). */
const SOURCE_WORDS: Record<string, Source> = {
  instagram: 'instagram',
  cosmos: 'cosmos',
  twitter: 'x',
}

const SOURCE_NAMES: Record<string, Source> = {
  x: 'x',
  twitter: 'x',
  instagram: 'instagram',
  cosmos: 'cosmos',
  web: 'web',
  extension: 'web',
  capture: 'capture',
  local: 'local',
  fichier: 'local',
  fichiers: 'local',
  import: 'local',
}

const KIND_NAMES: Record<string, ItemKind> = {
  image: 'image',
  images: 'image',
  photo: 'image',
  video: 'video',
  videos: 'video',
  vidéo: 'video',
  vidéos: 'video',
  post: 'tweet',
  posts: 'tweet',
  tweet: 'tweet',
  page: 'url',
  pages: 'url',
  url: 'url',
  lien: 'url',
}

/** Échappe un terme pour une chaîne FTS5 entre guillemets. */
export function quote(term: string): string {
  return `"${term.replace(/"/g, '""')}"`
}

/** Découpe en jetons, en gardant les segments entre guillemets d'un seul tenant. */
export function tokenize(raw: string): { text: string; quoted: boolean }[] {
  const out: { text: string; quoted: boolean }[] = []
  const re = /"([^"]*)"?|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    if (m[1] !== undefined) {
      const t = m[1].trim()
      if (t) out.push({ text: t, quoted: true })
    } else if (m[2]) out.push({ text: m[2], quoted: false })
  }
  return out
}

/** Retire la ponctuation de bord qui n'a pas de sens pour l'index (`unicode61`). */
function clean(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

const uniq = <T>(a: T[]): T[] => [...new Set(a)]

export function toFtsQuery(raw: string): ParsedQuery {
  const parts: string[] = []
  const sources: Source[] = []
  const kinds: ItemKind[] = []
  const tags: string[] = []
  const handles: string[] = []
  const sourceWords: Source[] = []
  const terms: string[] = []
  let color: string | null = null

  for (const tok of tokenize(raw.slice(0, 500))) {
    if (tok.quoted) {
      parts.push(quote(tok.text))
      terms.push(tok.text)
      continue
    }
    const t = tok.text
    const lower = t.toLowerCase()
    const kv = /^(type|source|couleur|color):(.+)$/i.exec(t)
    if (kv) {
      const key = kv[1]!.toLowerCase()
      const value = kv[2]!.toLowerCase()
      if (key === 'type' && KIND_NAMES[value]) {
        kinds.push(KIND_NAMES[value])
        continue
      }
      if (key === 'source' && SOURCE_NAMES[value]) {
        sources.push(SOURCE_NAMES[value])
        continue
      }
      if ((key === 'couleur' || key === 'color') && /^#?[0-9a-f]{6}$/.test(value)) {
        color = value.startsWith('#') ? value : `#${value}`
        continue
      }
    }
    if (t.startsWith('#') && t.length > 1) {
      const name = clean(t.slice(1))
      if (!name) continue
      const src = SOURCE_TAGS[name.toLowerCase()]
      if (src) sources.push(src)
      else {
        tags.push(name)
        parts.push(`tags:${quote(name)}*`)
      }
      continue
    }
    if (t.startsWith('@') && t.length > 1) {
      const handle = clean(t.slice(1))
      if (!handle) continue
      handles.push(handle)
      parts.push(`post_text:${quote(handle)}`)
      continue
    }
    const word = clean(t)
    if (!word) continue
    const sw = SOURCE_WORDS[lower]
    if (sw) sourceWords.push(sw)
    terms.push(word)
    parts.push(`${quote(word)}*`)
  }

  return {
    match: parts.length > 0 ? parts.join(' ') : null,
    sources: uniq(sources),
    kinds: uniq(kinds),
    tags: uniq(tags),
    handles: uniq(handles),
    color,
    sourceWords: uniq(sourceWords),
    terms,
  }
}
