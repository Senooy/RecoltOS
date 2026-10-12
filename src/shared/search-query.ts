/**
 * Search query (`search/fts-query`): typed text → FTS5 expression + filters.
 * Shared: main runs it, the renderer uses it to convert the syntax into chips.
 *  - bare words → `"word"*` (implicit AND, doubled quotes); `"a phrase"` → `"a phrase"`;
 *  - `#x #instagram #cosmos` (and the `#bookmark` alias → `x`) → `sources` filter, not FTS;
 *  - other `#tag` → `tags:"tag"*` (+ name kept for the chip); `@handle` → `post_text:"handle"`;
 *  - `type:video|image|post|page` (and `tweet`, `url`), `source:x`, `couleur:#ff3b30` → filters;
 *  - a bare word equal to a source (`instagram`, `cosmos`, `twitter`) is noted in `sourceWords`:
 *    the search puts that source's items first, then the full-text results.
 * Pure (no database): testable.
 */
import type { ItemKind, Source } from './enums'

import { NAMED_COLORS } from './color'

const foldName = (v: string): string => v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Hex of a named colour ("rouge", "Bleu"…), otherwise `null`. */
export function namedColorHex(value: string): string | null {
  const v = foldName(value)
  return NAMED_COLORS.find((c) => c.id === v || foldName(c.label) === v)?.hex ?? null
}

export interface ParsedQuery {
  /** FTS5 expression, `null` if there is no full-text term. */
  match: string | null
  sources: Source[]
  kinds: ItemKind[]
  tags: string[]
  handles: string[]
  color: string | null
  sourceWords: Source[]
  /** Bare terms (for highlighting and history). */
  terms: string[]
}

const SOURCE_TAGS: Record<string, Source> = {
  x: 'x',
  bookmark: 'x',
  twitter: 'x',
  instagram: 'instagram',
  cosmos: 'cosmos',
}

/** Bare words that name a source (union of the source filter). */
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

/** Escapes a term for an FTS5 quoted string. */
export function quote(term: string): string {
  return `"${term.replace(/"/g, '""')}"`
}

/** Splits into tokens, keeping quoted segments in one piece. */
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

/** Removes edge punctuation that is meaningless for the index (`unicode61`). */
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
      // `couleur:rouge`: one of the 12 named colours.
      const named = (key === 'couleur' || key === 'color') && namedColorHex(value)
      if (named) {
        color = named
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
