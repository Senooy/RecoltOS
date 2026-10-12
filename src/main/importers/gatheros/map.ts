/**
 * Correspondance champ par champ `saves` → `items`, `item_media`, `authors`.
 * Fonctions pures : aucune E/S, aucune base.
 */
import { createHash } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import { z } from 'zod'
import { hexToLab, hueBucket, labToLch, deltaE76 } from '../../../shared/color'
import { shard } from '../../../shared/ids'
import {
  PostMetaSchema,
  type PostMedia,
  type PostMeta,
  type PostPlatform,
} from '../../../shared/post-meta'
import type { AuthorInput, AuthorPlatform } from '../../db/repos/authors'
import type { ItemKindValue, ItemSourceValue, NewItem } from '../../db/repos/items'
import type { NewMedia } from '../../db/repos/media'
import type { SaveRow } from './read'

export const ORIGIN = 'gatheros'
export const STARTER_TAG = '__starter__'
/** Tags GatherOS qui ne deviennent pas des tags : ils sont dans `source` (chips virtuelles). */
export const SOURCE_TAGS: ReadonlySet<string> = new Set(['bookmark', 'instagram', 'cosmos', 'x'])
/** tags importés hors démarrage renommés en français. */
export const TAG_MAP_EN_FR: Readonly<Record<string, string>> = { screenshot: 'capture-ecran' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** UUID déterministe (forme v5 : version 5, variante RFC) dérivé d'une graine. */
export function deterministicUuid(seed: string): string {
  const h = createHash('sha1').update(`recoltos:gatheros:${seed}`).digest('hex')
  const v = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export function isUuid(s: string): boolean {
  return UUID_RE.test(s)
}

const WebUrlSchema = z.url({ protocol: /^https?$/ })

/** URL http(s) valide, sinon `null` (les chaînes vides deviennent `null`). */
export function webUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  return WebUrlSchema.safeParse(t).success ? t : null
}

export function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  return v.trim() ? v : null
}

export function cleanHandle(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const h = v.trim().replace(/^@+/, '').trim()
  return h || null
}

/** `external_id` extrait de l'URL source (X `/status/<n>`, IG `/(p|reel|tv)/<code>`, Cosmos `/e/<n>`). */
export function externalIdOf(source: string, url: string | null): string | null {
  if (!url) return null
  if (source === 'x') return /\/status(?:es)?\/(\d+)/.exec(url)?.[1] ?? null
  if (source === 'instagram') return /\/(?:p|reel|reels|tv)\/([^/?#]+)/.exec(url)?.[1] ?? null
  if (source === 'cosmos') return /\/e\/(\d+)/.exec(url)?.[1] ?? null
  return null
}

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Source RecoltOS : `url` hors x.com → `web` ; sans URL : `capture` (tag screenshot) ou `local`. */
export function mapSource(
  save: Pick<SaveRow, 'source' | 'source_url' | 'kind'>,
  tags: readonly string[],
): ItemSourceValue {
  const url = save.source_url?.trim() || null
  if (!url) return tags.includes('screenshot') ? 'capture' : 'local'
  if (save.kind === 'url') {
    const host = hostOf(url)
    if (host !== 'x.com' && host !== 'twitter.com' && host !== 'mobile.twitter.com') return 'web'
  }
  if (save.source === 'x' || save.source === 'instagram' || save.source === 'cosmos')
    return save.source
  return 'web'
}

export function mapKind(kind: string): ItemKindValue {
  return kind === 'video' || kind === 'tweet' || kind === 'url' ? kind : 'image'
}

const MIME: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  m4v: 'video/x-m4v',
}

export function extOf(name: string): string {
  return extname(name).replace(/^\./, '').toLowerCase()
}

export function mimeOf(name: string): string | null {
  return MIME[extOf(name)] ?? null
}

/** `moodmark-file://local/<chemin encodé>` → basename du fichier, sinon `null`. */
export function localBasename(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith('moodmark-file://local/')) return null
  try {
    const decoded = decodeURIComponent(url.slice('moodmark-file://local/'.length))
    const b = basename(decoded)
    return b && b !== '.' && b !== '..' && !b.includes('\0') ? b : null
  } catch {
    return null
  }
}

export interface ParsedPalette {
  palette: string[] | null
  paletteLab: [number, number, number][] | null
  colorL: number | null
  colorC: number | null
  colorH: number | null
  colorBucket: number
}

/** Palette importée conservée ; LCh et bucket de tri dérivés de la dominante. */
export function parsePalette(
  hexJson: string | null,
  labJson: string | null,
  warn: (m: string) => void,
): ParsedPalette {
  const none: ParsedPalette = {
    palette: null,
    paletteLab: null,
    colorL: null,
    colorC: null,
    colorH: null,
    colorBucket: 13,
  }
  let hex: string[] = []
  try {
    const raw: unknown = hexJson ? JSON.parse(hexJson) : null
    if (Array.isArray(raw))
      hex = raw
        .filter((h): h is string => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h))
        .map((h) => h.toLowerCase())
  } catch {
    warn('palette illisible')
  }
  if (hex.length === 0) return none
  hex = hex.slice(0, 8)
  let lab: [number, number, number][] | null = null
  try {
    const raw: unknown = labJson ? JSON.parse(labJson) : null
    if (Array.isArray(raw) && raw.length === hex.length) {
      const ok = raw.every(
        (t) =>
          Array.isArray(t) &&
          t.length === 3 &&
          t.every((n) => typeof n === 'number' && Number.isFinite(n)),
      )
      if (ok) lab = (raw as [number, number, number][]).map(([l, a, b]) => [l, a, b])
    }
  } catch {
    // recalculée ci-dessous
  }
  if (lab && deltaE76(hexToLab(hex[0]!), lab[0]!) > 5) {
    warn('palette_lab incohérente avec palette : recalculée')
    lab = null
  }
  if (!lab) lab = hex.map((h) => [...hexToLab(h)] as [number, number, number])
  const lch = labToLch(lab[0]!)
  return {
    palette: hex,
    paletteLab: lab,
    colorL: lch[0],
    colorC: lch[1],
    colorH: lch[2],
    colorBucket: hueBucket(lch),
  }
}

export type PlannedFileKind = 'main' | 'slide' | 'poster' | 'legacyThumb'

export interface PlannedFile {
  kind: PlannedFileKind
  /** Nom du fichier dans `images/` (ou `thumbs/` pour la miniature). */
  srcName: string
  dstRel: string
  mediaUuid: string
}

export type PlannedMedia = NewMedia & { uuid: string; position: number }

export interface MappedSave {
  item: NewItem & { uuid: string; origin: string; originId: string }
  media: PlannedMedia[]
  files: PlannedFile[]
  author: (AuthorInput & { name: string | null }) | null
  quotedAuthor: AuthorInput | null
  /** Images citées et de fil à télécharger (`remote.fetch`). */
  remoteImages: string[]
  tags: string[]
  warnings: string[]
}

interface TweetMetaG {
  authorName?: unknown
  authorHandle?: unknown
  authorAvatarUrl?: unknown
  caption?: unknown
  media?: unknown
  imageUrls?: unknown
  videoUrl?: unknown
  posterUrl?: unknown
  quoted?: unknown
  thread?: unknown
}

function parseTweetMeta(raw: string | null): TweetMetaG | null {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

function urls(v: unknown): string[] {
  return Array.isArray(v) ? v.map(webUrl).filter((u): u is string => u !== null) : []
}

const imageMedia = (u: string): PostMedia => ({
  type: 'image',
  remoteUrl: u,
  posterUrl: null,
  mediaUuid: null,
})

function authorPlatform(p: PostPlatform): AuthorPlatform {
  return p
}

export interface MapOptions {
  importAiFields: boolean
  /** Fichiers présents dans `thumbs/` de GatherOS (miniature legacy copiée si présente). */
  hasThumb?: (name: string) => boolean
}

export function mapSave(save: SaveRow, tags: readonly string[], opts: MapOptions): MappedSave {
  const warnings: string[] = []
  const warn = (m: string) => warnings.push(`${save.id} : ${m}`)
  const kind = mapKind(save.kind)
  const source = mapSource(save, tags)
  const sourceUrl = webUrl(save.source_url)
  const externalId = externalIdOf(source, sourceUrl)
  const platform: PostPlatform =
    source === 'x' || source === 'instagram' || source === 'cosmos' ? source : 'web'

  // Média principal (position 0) = `file_path`.
  const mainName = basename(save.file_path || '')
  const mainStem = mainName.replace(/\.[^.]+$/, '')
  const mainUuid = isUuid(mainStem) ? mainStem.toLowerCase() : deterministicUuid(`${save.id}:0`)
  const mainExt = extOf(mainName) || (kind === 'video' ? 'mp4' : 'webp')
  const mainRel = `items/${shard(mainUuid)}/${mainUuid}.${mainExt}`
  const files: PlannedFile[] = []
  if (mainName)
    files.push({ kind: 'main', srcName: mainName, dstRel: mainRel, mediaUuid: mainUuid })
  const thumbName = save.thumb_path ? basename(save.thumb_path) : null
  let legacyThumbRel: string | null = null
  if (thumbName && (opts.hasThumb?.(thumbName) ?? true)) {
    legacyThumbRel = `thumbs/${shard(mainUuid)}/${mainUuid}.legacy.${extOf(thumbName) || 'jpg'}`
    files.push({
      kind: 'legacyThumb',
      srcName: thumbName,
      dstRel: legacyThumbRel,
      mediaUuid: mainUuid,
    })
  }
  const media: PlannedMedia[] = [
    {
      uuid: mainUuid,
      position: 0,
      mediaType: kind === 'video' ? 'video' : 'image',
      role: kind === 'tweet' ? 'render' : kind === 'url' ? 'screenshot' : 'original',
      status: 'processing',
      fileRel: mainRel,
      mime: mimeOf(mainName),
      width: save.width && save.width > 0 ? Math.round(save.width) : null,
      height: save.height && save.height > 0 ? Math.round(save.height) : null,
      fileSize: save.file_size && save.file_size > 0 ? Math.round(save.file_size) : null,
      legacyThumbRel,
      originId: mainName || null,
      createdAt: save.created_at,
    },
  ]

  // Post (`tweet_meta` → `post_meta` v1).
  const tm = parseTweetMeta(save.tweet_meta)
  if (save.tweet_meta && !tm) warn('tweet_meta illisible')
  let postMeta: PostMeta | null = null
  let author: MappedSave['author'] = null
  let quotedAuthor: AuthorInput | null = null
  const remoteImages: string[] = []
  let mediaCount = 1
  if (tm) {
    const name = cleanText(tm.authorName)?.trim() ?? null
    const handle = cleanHandle(tm.authorHandle)
    const avatarUrl = webUrl(tm.authorAvatarUrl)
    if (handle) {
      author = {
        platform: authorPlatform(platform),
        handle,
        name,
        avatarUrl,
        sampleExternalId: externalId,
      }
    }
    const postMedia: PostMedia[] = []
    const list = Array.isArray(tm.media) ? (tm.media as unknown[]) : null
    if (list && list.length > 0) {
      mediaCount = Math.max(1, list.length)
      list.forEach((entry, k) => {
        const m = (entry && typeof entry === 'object' ? entry : {}) as {
          type?: unknown
          url?: unknown
          poster?: unknown
        }
        const type: 'image' | 'video' = m.type === 'video' ? 'video' : 'image'
        const remote = webUrl(m.url)
        const remotePoster = webUrl(m.poster)
        if (k === 0) {
          postMedia.push({ type, remoteUrl: remote, posterUrl: remotePoster, mediaUuid: mainUuid })
          return
        }
        const local = localBasename(m.url)
        if (local) {
          const stem = local.replace(/\.[^.]+$/, '')
          const uuid = isUuid(stem)
            ? stem.toLowerCase()
            : deterministicUuid(`${save.id}:${k}:${local}`)
          const fileRel = `items/${shard(uuid)}/${uuid}.${extOf(local) || (type === 'video' ? 'mp4' : 'jpg')}`
          files.push({ kind: 'slide', srcName: local, dstRel: fileRel, mediaUuid: uuid })
          let posterRel: string | null = null
          const posterLocal = localBasename(m.poster)
          if (posterLocal) {
            posterRel = `posters/${shard(uuid)}/${uuid}.jpg`
            files.push({ kind: 'poster', srcName: posterLocal, dstRel: posterRel, mediaUuid: uuid })
          }
          media.push({
            uuid,
            position: k,
            mediaType: type,
            role: 'original',
            status: 'processing',
            fileRel,
            mime: mimeOf(local),
            posterRel,
            remotePosterUrl: remotePoster,
            originId: local,
            createdAt: save.created_at,
          })
          postMedia.push({ type, remoteUrl: null, posterUrl: remotePoster, mediaUuid: uuid })
        } else if (remote) {
          const uuid = deterministicUuid(`${save.id}:${remote}`)
          media.push({
            uuid,
            position: k,
            mediaType: type,
            role: 'original',
            status: 'remote',
            fileRel: null,
            remoteUrl: remote,
            remotePosterUrl: remotePoster,
            originId: null,
            createdAt: save.created_at,
          })
          postMedia.push({ type, remoteUrl: remote, posterUrl: remotePoster, mediaUuid: uuid })
        } else {
          warn(`média ${k} sans URL exploitable`)
        }
      })
    } else if (kind === 'image' || kind === 'video') {
      const remote = webUrl(tm.videoUrl) ?? urls(tm.imageUrls)[0] ?? null
      postMedia.push({
        type: kind,
        remoteUrl: remote,
        posterUrl: webUrl(tm.posterUrl),
        mediaUuid: mainUuid,
      })
    } else {
      postMedia.push(...urls(tm.imageUrls).map(imageMedia))
    }

    let quoted: PostMeta['quoted'] = null
    if (tm.quoted && typeof tm.quoted === 'object' && !Array.isArray(tm.quoted)) {
      const q = tm.quoted as TweetMetaG
      const qName = cleanText(q.authorName)?.trim() ?? null
      const qHandle = cleanHandle(q.authorHandle)
      const qAvatar = webUrl(q.authorAvatarUrl)
      const qImages = urls(q.imageUrls)
      remoteImages.push(...qImages)
      if (qHandle)
        quotedAuthor = {
          platform: authorPlatform(platform),
          handle: qHandle,
          name: qName,
          avatarUrl: qAvatar,
        }
      quoted = {
        author: qName || qHandle ? { name: qName, handle: qHandle, avatarUrl: qAvatar } : null,
        text: cleanText(q.caption),
        url: null,
        media: qImages.map(imageMedia),
      }
    }
    const thread: PostMeta['thread'] = Array.isArray(tm.thread)
      ? (tm.thread as unknown[]).map((t) => {
          const e = (t && typeof t === 'object' ? t : {}) as { text?: unknown; imageUrls?: unknown }
          const imgs = urls(e.imageUrls)
          remoteImages.push(...imgs)
          return { text: typeof e.text === 'string' ? e.text : '', media: imgs.map(imageMedia) }
        })
      : []

    const candidate = {
      v: 1 as const,
      platform,
      author: name || handle ? { name, handle, avatarUrl } : null,
      text: cleanText(tm.caption),
      url: sourceUrl,
      postedAt: null,
      media: postMedia,
      quoted,
      thread,
    }
    const parsed = PostMetaSchema.safeParse(candidate)
    if (parsed.success) postMeta = parsed.data
    else warn('tweet_meta non convertible : post ignoré')
  }

  const pal = parsePalette(save.palette, save.palette_lab, warn)
  const ai = opts.importAiFields
  const description = ai ? cleanText(save.ai_description) : null
  const title = ai ? (cleanText(save.title)?.trim() ?? null) : null
  const updatedAt = Math.max(
    save.created_at,
    save.viewed_at ?? 0,
    save.deleted_at ?? 0,
    save.hidden_at ?? 0,
  )
  const mappedTags = tags
    .filter((t) => t !== STARTER_TAG && !SOURCE_TAGS.has(t))
    .map((t) => TAG_MAP_EN_FR[t] ?? t)

  return {
    item: {
      uuid: save.id.toLowerCase(),
      kind,
      source,
      externalId,
      sourceUrl,
      title,
      titleSource: title ? 'import' : null,
      notes: cleanText(save.notes),
      mediaCount,
      palette: pal.palette,
      paletteLab: pal.paletteLab,
      paletteWeights: null,
      colorL: pal.colorL,
      colorC: pal.colorC,
      colorH: pal.colorH,
      colorBucket: pal.colorBucket,
      postMeta,
      aiDescription: description,
      ocrText: ai ? cleanText(save.ocr_text) : null,
      aiPrompt: ai ? cleanText(save.ai_prompt) : null,
      aiState: description ? 'done' : 'none',
      aiProvider: description ? 'gatheros' : null,
      aiLang: description ? 'en' : null,
      origin: ORIGIN,
      originId: save.id,
      legacyHash: save.content_hash,
      createdAt: save.created_at,
      updatedAt,
      viewedAt: save.viewed_at,
      viewCount: Math.max(0, Math.round(save.view_count)),
      hiddenAt: save.hidden_at,
      deletedAt: save.deleted_at,
    },
    media,
    files,
    author,
    quotedAuthor,
    remoteImages: [...new Set(remoteImages)],
    tags: [...new Set(mappedTags)],
    warnings,
  }
}

/** Clé `dismissed_tweets` → `(source, external_id)`. */
export function mapDismissedKey(key: string): { source: string; externalId: string } {
  const i = key.indexOf(':')
  if (i > 0) {
    const prefix = key.slice(0, i)
    const rest = key.slice(i + 1)
    const source =
      prefix === 'ig' || prefix === 'instagram'
        ? 'instagram'
        : prefix === 'x'
          ? 'x'
          : prefix === 'cosmos'
            ? 'cosmos'
            : null
    if (source && rest) return { source, externalId: rest }
  }
  return { source: /^\d+$/.test(key) ? 'x' : 'unknown', externalId: key }
}

/** Chemin source d'un fichier planifié. */
export function sourceAbs(dirs: { images: string; thumbs: string }, f: PlannedFile): string {
  return join(f.kind === 'legacyThumb' ? dirs.thumbs : dirs.images, f.srcName)
}
