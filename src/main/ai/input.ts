/**
 * Builds the `AiInput` of an item: media prepared in the job folder,
 * minimal context (host only, never the full URL; post caption and author; duration; carousel),
 * vocabulary. Only reads the database and the library files.
 */
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { AiError, type AiInput, type AiMedia, type AiTask } from '../../shared/ai-types'
import { parsePostMeta, type PostMeta } from '../../shared/post-meta'
import type { ItemRow } from '../db/repos/items'
import type { MediaRow } from '../db/repos/media'
import type { MediaCaller } from '../jobs/handlers/types'
import type { LibraryContext } from '../library/library-context'
import {
  AI_FRAME_MAX_EDGE,
  getVideoKeyframes,
  pickSlides,
  prepareImageForAi,
  workerFrameExtractor,
  type Slide,
} from './media'
import { CAPTION_MAX, PAGE_TITLE_MAX, TWEET_MAX, clip } from './prompts'
import { buildVocabulary } from './tags'

export interface BuildInputDeps {
  lib: LibraryContext
  media: MediaCaller
  hasTool(name: 'ffmpeg' | 'ffprobe'): boolean
  /** `<userData>/cache/frames`. */
  framesDir: string
  signal?: AbortSignal
}

const SOURCE_LABEL: Partial<Record<string, AiInput['context']['sourceLabel']>> = {
  x: 'X',
  instagram: 'Instagram',
  cosmos: 'Cosmos',
  web: 'Web',
}

export function hostOf(url: string | null): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
    return u.hostname.replace(/^www\./, '') || undefined
  } catch {
    return undefined
  }
}

function handle(h: string | null | undefined): string {
  return h ? `@${h.replace(/^@+/, '')}` : ''
}

export function postContext(
  post: PostMeta | null,
  kind: ItemRow['kind'],
): AiInput['context']['post'] {
  const text = post?.text?.trim()
  if (!post || !text) return undefined
  const max = kind === 'tweet' ? TWEET_MAX : CAPTION_MAX
  const out: NonNullable<AiInput['context']['post']> = {
    authorName: post.author?.name ?? '',
    authorHandle: handle(post.author?.handle),
    caption: clip(text, max),
  }
  const q = post.quoted
  if (q?.text?.trim()) {
    out.quoted = {
      authorName: q.author?.name ?? '',
      authorHandle: handle(q.author?.handle),
      caption: clip(q.text, CAPTION_MAX),
    }
  }
  return out
}

function existing(lib: LibraryContext, rels: (string | null)[]): string | null {
  for (const r of rels) {
    if (!r) continue
    try {
      const abs = lib.paths.abs(r)
      if (existsSync(abs)) return abs
    } catch {
      // invalid path: ignored
    }
  }
  return null
}

function imageSource(lib: LibraryContext, m: MediaRow): string | null {
  return existing(lib, [m.file_rel, m.display_rel, m.large_rel, m.thumb_rel, m.legacy_thumb_rel])
}

function stillOfVideo(lib: LibraryContext, m: MediaRow): string | null {
  return existing(lib, [m.poster_rel, m.thumb_rel, m.legacy_thumb_rel])
}

export interface BuiltInput {
  input: AiInput
  item: ItemRow
}

/** Builds the input and prepares the JPEGs in `jobDir` (created). */
export async function buildAiInput(
  deps: BuildInputDeps,
  item: ItemRow,
  jobDir: string,
  task: AiTask,
): Promise<BuiltInput> {
  const { lib } = deps
  await mkdir(jobDir, { recursive: true, mode: 0o700 })
  const rows = lib.db
    .prepare('SELECT * FROM item_media WHERE item_id = ? ORDER BY position')
    .all(item.id) as MediaRow[]
  const post = parsePostMeta(item.post_meta)
  const ctx: AiInput['context'] = {}
  const label = SOURCE_LABEL[item.source]
  if (label) ctx.sourceLabel = label
  const host = hostOf(item.source_url)
  if (host) ctx.sourceHost = host
  if (item.kind === 'url' && item.title) ctx.pageTitle = clip(item.title, PAGE_TITLE_MAX)
  const pc = postContext(post, item.kind)
  if (pc) ctx.post = pc

  const opt = deps.signal ? { signal: deps.signal } : {}
  const media: AiMedia[] = []
  const prep = async (src: string, i: number, maxEdge?: number) =>
    media.push(
      await prepareImageForAi(deps.media, src, jobDir, `img${i}.jpg`, {
        ...opt,
        ...(maxEdge ? { maxEdge } : {}),
      }),
    )
  const cover = rows[0]

  if (task === 'imagePrompt') {
    const src =
      cover && cover.media_type === 'video'
        ? stillOfVideo(lib, cover)
        : cover
          ? imageSource(lib, cover)
          : null
    if (!src) throw new AiError('FILE_MISSING', 'média introuvable')
    await prep(src, 1)
  } else if (item.kind === 'tweet') {
    if (!pc) {
      const src = cover ? imageSource(lib, cover) : null
      if (src) await prep(src, 1)
    }
  } else if (item.kind === 'video') {
    if (!cover) throw new AiError('FILE_MISSING', 'média introuvable')
    const video = cover.media_type === 'video' ? existing(lib, [cover.file_rel]) : null
    const canFrames = deps.hasTool('ffmpeg') && deps.hasTool('ffprobe')
    const kf = await getVideoKeyframes({
      itemUuid: item.uuid,
      video,
      fallbackImage:
        stillOfVideo(lib, cover) ?? (cover.media_type === 'image' ? imageSource(lib, cover) : null),
      cacheDir: deps.framesDir,
      durationSec: async () => {
        if (cover.duration_ms && cover.duration_ms > 0) return cover.duration_ms / 1000
        if (!video || !canFrames) return null
        const p = await deps.media('probeVideo', { abs: video }, { timeoutMs: 30_000, ...opt })
        return p.durationMs / 1000
      },
      extract: video && canFrames ? workerFrameExtractor(deps.media, deps.signal) : null,
    })
    if (kf.frames.length === 0) throw new AiError('FILE_MISSING', 'aucune image de la vidéo')
    let i = 1
    for (const f of kf.frames) await prep(f, i++, AI_FRAME_MAX_EDGE)
    if (kf.durationSec) ctx.videoDurationSec = Math.round(kf.durationSec * 10) / 10
  } else {
    // image or url: cover, or carousel (local slides).
    const slides: Slide[] = []
    for (const m of rows) {
      if (m.status !== 'ok' && m.status !== 'processing') continue
      const src = m.media_type === 'image' ? imageSource(lib, m) : null
      if (m.media_type === 'video') slides.push({ index: m.position, path: '', type: 'video' })
      else if (src) slides.push({ index: m.position, path: src, type: 'image' })
    }
    const total = Math.max(item.media_count, rows.length)
    if (item.kind === 'image' && total >= 2) {
      const picks = pickSlides(slides, 3)
      if (picks.length === 0) throw new AiError('FILE_MISSING', 'média introuvable')
      let i = 1
      for (const s of picks) await prep(s.path, i++)
      ctx.carousel = { total, slideNumbers: picks.map((s) => s.index + 1) }
    } else {
      const first = slides.find((s) => s.type === 'image')
      const src = first?.path ?? (cover ? imageSource(lib, cover) : null)
      if (!src) throw new AiError('FILE_MISSING', 'média introuvable')
      await prep(src, 1)
    }
  }

  return {
    item,
    input: {
      itemUuid: item.uuid,
      kind: item.kind,
      media,
      context: ctx,
      vocabulary: buildVocabulary(lib.db),
    },
  }
}
