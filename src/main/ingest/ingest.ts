/**
 * Pipeline d'ingestion unique : acquisition vers `tmp/<uuid>.part` (clonage APFS +
 * sha256 dans le media-worker), typage par le contenu, dédoublonnage par hash (restauration depuis
 * la corbeille), métadonnées, commit atomique, transaction (`items`, `item_media`, couverture,
 * tags, collection), porte IA, `items.changed{created}` AVANT les dérivés, puis job `media.derive`.
 *
 * Entrées livrées en M1 : `file`, `capture`, `clipboard`, `url` (média direct ou capture de page
 * si `captureUrl` est fourni). M5 : `extension` (`SaveRequest` de l'extension, `ingestExtension`) ;
 * les publications synchronisées passent par `sync/ingest.ts` (une transaction par page).
 */
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { AppError } from '../../shared/errors'
import { newUuid } from '../../shared/ids'
import { JOB_PRIORITY } from '../../shared/jobs'
import type { PostMeta } from '../../shared/post-meta'
import type { SaveRequest } from '../../shared/bridge/save'
import type { ItemSourceValue, NewItem } from '../db/repos/items'
import type { NewMedia } from '../db/repos/media'
import { fetchToFile, assertWebUrl } from '../jobs/fetch'
import type { JobServices } from '../jobs/handlers/types'
import { rel } from '../library/paths'
import { AI_MAX_ATTEMPTS } from '../ai/errors'
import { autoJobPayload } from '../ai/service'
import { aiGate } from './ai-gate'
import { detectType, readHead, requireType, type DetectedType } from './media-type'

export type IngestInput =
  | { type: 'file'; path: string }
  | { type: 'url'; url: string }
  | { type: 'capture'; path: string; mode: 'region' | 'window' | 'screen' }
  | { type: 'clipboard'; image: Buffer; mime: string }
  | { type: 'extension'; payload: SaveRequest; uploadPath?: string }
  | { type: 'sync'; source: 'x' | 'instagram' | 'cosmos'; post: unknown; batchSize: number }

export interface IngestOptions {
  collectionUuid?: string
  spaceUuid?: string
  title?: string
  tags?: string[]
  /** Note de l'utilisateur (popup de l'extension). */
  notes?: string
}

export interface IngestResult {
  itemUuid: string
  status: 'created' | 'duplicate' | 'restored' | 'dismissed'
}

export interface PageCapture {
  png: Buffer
  title: string | null
  description: string | null
}

export interface IngestDeps extends JobServices {
  now?: () => number
  /** Capture d'une page HTML (fenêtre hors écran 1440×900) ; absent → `unsupported`. */
  captureUrl?: (url: string) => Promise<PageCapture>
}

const MEDIA_TIMEOUT = { timeoutMs: 120_000 } as const

interface LocalSource {
  /** Fichier à copier (jamais modifié) ou fichier temporaire déjà dans `tmp/` (déplacé). */
  abs: string
  owned: boolean
  name: string
  source: ItemSourceValue
  sourceUrl: string | null
  kindOverride?: 'url'
  role?: 'original' | 'screenshot'
  origin?: 'app' | 'extension' | 'capture'
  title?: string | null
  postMeta?: PostMeta | null
}

/** Item vivant ou en corbeille portant ce hash de contenu. */
function findByHash(deps: IngestDeps, sha: string) {
  return deps.lib.db
    .prepare(
      `SELECT i.id, i.uuid, i.deleted_at FROM item_media m JOIN items i ON i.id = m.item_id
       WHERE m.content_hash = ? ORDER BY (i.deleted_at IS NOT NULL), m.id LIMIT 1`,
    )
    .get(sha) as { id: number; uuid: string; deleted_at: number | null } | undefined
}

function addToCollection(deps: IngestDeps, itemId: number, collectionUuid?: string): void {
  if (!collectionUuid) return
  const cid = deps.lib.repos.collections.idByUuid(collectionUuid)
  if (cid === undefined) throw new AppError('not_found', 'Collection introuvable.')
  deps.lib.repos.collections.addItems(cid, [itemId])
}

async function ingestLocal(
  src: LocalSource,
  opts: IngestOptions,
  deps: IngestDeps,
): Promise<IngestResult> {
  const { lib } = deps
  const now = deps.now ?? Date.now
  const mediaUuid = newUuid()
  const tmpDir = lib.paths.dir('tmp')
  await mkdir(tmpDir, { recursive: true })
  const partAbs = lib.paths.abs(rel.tmp(`${mediaUuid}.part`))
  let decodedAbs: string | null = null
  try {
    // 1. Acquisition (clonage APFS dans le worker, ou déplacement d'un fichier temporaire).
    if (src.owned) await rename(src.abs, partAbs)
    else await deps.media('cloneFile', { src: src.abs, dst: partAbs }, MEDIA_TIMEOUT)
    const { sha256, bytes } = await deps.media('hashFile', { abs: partAbs }, MEDIA_TIMEOUT)

    // 2. Typage par le contenu.
    const type: DetectedType = await requireType(await readHead(partAbs), src.name)

    // 3. Dédoublonnage par contenu (restauration depuis la corbeille).
    const dup = findByHash(deps, sha256)
    if (dup) {
      await rm(partAbs, { force: true })
      let status = 'duplicate' as IngestResult['status']
      lib.db.transaction(() => {
        if (dup.deleted_at !== null) {
          lib.repos.items.restore([dup.id], now())
          status = 'restored'
        }
        addToCollection(deps, dup.id, opts.collectionUuid)
      })()
      deps.changed([dup.uuid], status === 'restored' ? 'restored' : 'updated')
      return { itemUuid: dup.uuid, status }
    }

    // 4. Métadonnées (sips d'abord pour HEIC/HEIF/PSD).
    let width: number | null = null
    let height: number | null = null
    let isAnimated = false
    let durationMs: number | null = null
    let hasAudio: boolean | null = null
    let playable = true
    if (type.mediaType === 'image') {
      let probeAbs = partAbs
      if (type.foreign) {
        decodedAbs = lib.paths.abs(rel.tmp(`${mediaUuid}.decoded.png`))
        await deps.media(
          'decodeForeign',
          { src: partAbs, dst: decodedAbs, format: 'png' },
          MEDIA_TIMEOUT,
        )
        probeAbs = decodedAbs
      }
      const p = await deps.media('probeImage', { abs: probeAbs }, MEDIA_TIMEOUT)
      width = p.width
      height = p.height
      isAnimated = p.isAnimated
    } else if (deps.hasTool('ffprobe')) {
      const p = await deps.media('probeVideo', { abs: partAbs }, MEDIA_TIMEOUT)
      width = p.width
      height = p.height
      durationMs = p.durationMs
      hasAudio = p.hasAudio
      playable = p.playable
    }

    // 5. Commit des fichiers : l'original n'est jamais ré-encodé.
    const fileRel = rel.original(mediaUuid, type.ext)
    const fileAbs = lib.paths.abs(fileRel)
    await mkdir(dirname(fileAbs), { recursive: true })
    await rename(partAbs, fileAbs)
    let displayRel: string | null = null
    if (type.needsDisplay) {
      displayRel = rel.display(mediaUuid)
      const dAbs = lib.paths.abs(displayRel)
      await mkdir(dirname(dAbs), { recursive: true })
      await deps.media(
        'makeDisplay',
        { src: decodedAbs ?? fileAbs, dst: dAbs, maxEdge: 2048 },
        MEDIA_TIMEOUT,
      )
    }

    // 6. Transaction en base.
    const at = now()
    const prefs = deps.prefs()
    const kind = src.kindOverride ?? type.mediaType
    let created: { id: number; uuid: string; mediaIds: number[] } | null = null
    let aiState: 'queued' | 'none' = 'none'
    lib.db.transaction(() => {
      aiState = aiGate({ prefs, settings: lib.repos.settings, userAction: true, now: at })
      const item: NewItem = {
        kind,
        source: src.source,
        sourceUrl: src.sourceUrl,
        title: opts.title ?? src.title ?? null,
        titleSource: opts.title ? 'user' : src.title ? 'source' : null,
        postMeta: src.postMeta ?? null,
        notes: opts.notes ?? null,
        aiState,
        origin: src.origin ?? (src.source === 'capture' ? 'capture' : 'app'),
        createdAt: at,
      }
      const media: NewMedia = {
        uuid: mediaUuid,
        mediaType: type.mediaType,
        role: src.role ?? 'original',
        status: 'processing',
        fileRel,
        mime: type.mime,
        width,
        height,
        fileSize: bytes,
        durationMs,
        hasAudio,
        isAnimated,
        playable,
        contentHash: sha256,
        displayRel,
        createdAt: at,
      }
      created = lib.repos.items.insertWithMedia(item, [media])
      addToCollection(deps, created.id, opts.collectionUuid)
      if (opts.tags && opts.tags.length > 0)
        lib.repos.tags.addToItems([created.id], opts.tags, 'user', at)
      for (const mid of created.mediaIds) {
        lib.repos.jobs.enqueue(
          {
            type: 'media.derive',
            itemId: created.id,
            dedupeKey: `media:${mid}`,
            payload: { mediaId: mid },
            priority: JOB_PRIORITY.INTERACTIVE,
          },
          at,
        )
      }
      if (aiState === 'queued') {
        lib.repos.jobs.enqueue(
          {
            type: 'ai.enrich',
            itemId: created.id,
            dedupeKey: `ai:${created.id}`,
            priority: JOB_PRIORITY.INTERACTIVE,
            payload: { ...autoJobPayload(prefs.ai) },
            maxAttempts: AI_MAX_ATTEMPTS,
          },
          at,
        )
      }
    })()
    const c = created as { id: number; uuid: string } | null
    if (!c) throw new AppError('internal', 'insertion impossible')
    deps.changed([c.uuid], 'created')
    deps.kick()
    return { itemUuid: c.uuid, status: 'created' }
  } finally {
    await rm(partAbs, { force: true })
    if (decodedAbs) await rm(decodedAbs, { force: true })
    if (src.owned) await rm(src.abs, { force: true })
  }
}

async function ingestUrl(
  url: string,
  opts: IngestOptions,
  deps: IngestDeps,
): Promise<IngestResult> {
  const u = assertWebUrl(url)
  const tmpAbs = deps.lib.paths.abs(rel.tmp(`${newUuid()}.dl`))
  const got = await fetchToFile(deps.fetch, url, tmpAbs)
  const type = await detectType(got.head)
  if (type) {
    return ingestLocal(
      {
        abs: tmpAbs,
        owned: true,
        name: basename(u.pathname) || u.hostname,
        source: 'web',
        sourceUrl: url,
      },
      opts,
      deps,
    )
  }
  await rm(tmpAbs, { force: true })
  if (got.contentType !== 'text/html' || !deps.captureUrl) {
    throw new AppError('unsupported', `Contenu non pris en charge : ${u.hostname}`)
  }
  const page = await deps.captureUrl(url)
  const pngAbs = deps.lib.paths.abs(rel.tmp(`${newUuid()}.page.png`))
  await writeFile(pngAbs, page.png)
  const postMeta: PostMeta = {
    v: 1,
    platform: 'web',
    author: null,
    text: page.description,
    url,
    postedAt: null,
    media: [],
    quoted: null,
    thread: [],
  }
  return ingestLocal(
    {
      abs: pngAbs,
      owned: true,
      name: u.hostname,
      source: 'web',
      sourceUrl: url,
      kindOverride: 'url',
      role: 'screenshot',
      title: page.title,
      postMeta,
    },
    opts,
    deps,
  )
}

export async function ingest(
  input: IngestInput,
  opts: IngestOptions,
  deps: IngestDeps,
): Promise<IngestResult> {
  switch (input.type) {
    case 'file': {
      const st = await stat(input.path).catch(() => null)
      if (!st) throw new AppError('not_found', `Fichier introuvable : ${basename(input.path)}`)
      if (!st.isFile()) throw new AppError('validation', `Pas un fichier : ${basename(input.path)}`)
      return ingestLocal(
        {
          abs: input.path,
          owned: false,
          name: basename(input.path),
          source: 'local',
          sourceUrl: null,
        },
        opts,
        deps,
      )
    }
    case 'capture':
      return ingestLocal(
        {
          abs: input.path,
          owned: false,
          name: basename(input.path),
          source: 'capture',
          sourceUrl: null,
        },
        opts,
        deps,
      )
    case 'clipboard': {
      const abs = deps.lib.paths.abs(rel.tmp(`${newUuid()}.clip`))
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, input.image)
      return ingestLocal(
        { abs, owned: true, name: 'presse-papiers', source: 'local', sourceUrl: null },
        opts,
        deps,
      )
    }
    case 'url':
      return ingestUrl(input.url, opts, deps)
    case 'extension':
      return ingestExtension(input.payload, opts, deps, input.uploadPath)
    default:
      throw new AppError('not_implemented', `ingestion ${input.type} non disponible`)
  }
}

/** Source d'un enregistrement d'après l'hôte de la page. */
export function sourceFromPageUrl(pageUrl: string): ItemSourceValue {
  let host = ''
  try {
    host = new URL(pageUrl).hostname.toLowerCase()
  } catch {
    return 'web'
  }
  const is = (d: string) => host === d || host.endsWith(`.${d}`)
  if (is('x.com') || is('twitter.com')) return 'x'
  if (is('instagram.com')) return 'instagram'
  if (is('cosmos.so')) return 'cosmos'
  return 'web'
}

const DATA_URL = /^data:([a-z0-9.+/-]+)?(;base64)?,/i

/**
 * Enregistrement venu de l'extension (`save.create`) : image / vidéo (URL http(s)
 * téléchargée par l'app, `data:`, inline ≤ 8 Mio ou fichier assemblé par `media.chunk`), page
 * (capture d'onglet), lien (capture hors écran par l'app). Les publications (`kind: 'post'`) passent
 * par la sync (`sync/ingest.ts`).
 */
export async function ingestExtension(
  req: SaveRequest,
  opts: IngestOptions,
  deps: IngestDeps,
  uploadPath?: string,
): Promise<IngestResult> {
  const source = sourceFromPageUrl(req.pageUrl)
  const base = { source, sourceUrl: req.pageUrl, origin: 'extension' as const }
  const tmp = (ext: string) => deps.lib.paths.abs(rel.tmp(`${newUuid()}.${ext}`))
  const writeTmp = async (b64: string, ext: string) => {
    const abs = tmp(ext)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, Buffer.from(b64, 'base64'))
    return abs
  }
  if (req.kind === 'image' || req.kind === 'video') {
    if (uploadPath) {
      return ingestLocal({ ...base, abs: uploadPath, owned: true, name: 'envoi' }, opts, deps)
    }
    if (req.inlineMedia) {
      const abs = await writeTmp(req.inlineMedia.dataBase64, 'inline')
      return ingestLocal({ ...base, abs, owned: true, name: 'image' }, opts, deps)
    }
    const src = req.srcUrl ?? ''
    const data = DATA_URL.exec(src)
    if (data) {
      if (!data[2]) throw new AppError('unsupported', 'Image intégrée non prise en charge.')
      const abs = await writeTmp(src.slice(data[0].length), 'data')
      return ingestLocal({ ...base, abs, owned: true, name: 'image' }, opts, deps)
    }
    const u = assertWebUrl(src)
    const abs = tmp('dl')
    await fetchToFile(deps.fetch, src, abs)
    return ingestLocal(
      { ...base, abs, owned: true, name: basename(u.pathname) || u.hostname },
      opts,
      deps,
    )
  }
  if (req.kind === 'page' && req.screenshot) {
    const abs = await writeTmp(
      req.screenshot.dataBase64,
      req.screenshot.mime === 'image/png' ? 'png' : 'jpg',
    )
    const postMeta: PostMeta = {
      v: 1,
      platform: 'web',
      author: null,
      text: req.pageMeta?.description ?? null,
      url: req.pageUrl,
      postedAt: null,
      media: [],
      quoted: null,
      thread: [],
    }
    return ingestLocal(
      {
        abs,
        owned: true,
        name: 'page',
        source: 'web',
        sourceUrl: req.pageUrl,
        origin: 'extension',
        kindOverride: 'url',
        role: 'screenshot',
        title: req.pageTitle ?? req.pageMeta?.ogTitle ?? null,
        postMeta,
      },
      opts,
      deps,
    )
  }
  if (req.kind === 'page' || req.kind === 'link') {
    const target = req.kind === 'link' ? (req.linkUrl ?? '') : req.pageUrl
    return ingestUrl(target, opts, deps)
  }
  throw new AppError('unsupported', 'Type d’enregistrement non pris en charge.')
}
