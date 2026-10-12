/**
 * Enregistrements venus de l'extension : `save.create` → ingestion, envoi découpé
 * (`media.chunk` puis `save.create{upload}`), collections pour les menus et la popup.
 * Les publications (`kind: 'post'`) sont confiées au saveur de posts de la sync (`setPostSaver`).
 */
import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { MAX_UPLOAD_BYTES } from '../../shared/bridge/constants'
import type {
  BridgeCollection,
  MediaChunkMessage,
  SaveAck,
  SaveRequest,
} from '../../shared/bridge/save'
import { AppError } from '../../shared/errors'
import { collectionRows } from '../db/queries/tree'
import { emitCollectionsChanged } from '../events'
import { ingestExtension, type IngestDeps, type IngestResult } from '../ingest/ingest'
import { rel } from '../library/paths'
import type { LibraryContext } from '../library/library-context'

export type PostSaver = (req: SaveRequest, collectionUuid: string | null) => Promise<IngestResult>

interface Upload {
  abs: string
  stream: WriteStream
  nextSeq: number
  bytes: number
  done: boolean
  failed: string | null
  startedAt: number
}

export interface SaveServiceDeps {
  ingestDeps(): IngestDeps
  log: { warn(...a: unknown[]): void }
  now?: () => number
}

export class SaveService {
  private readonly deps: SaveServiceDeps
  private uploads = new Map<string, Upload>()
  private sinks = new Map<string, (m: MediaChunkMessage) => void>()
  private postSaver: PostSaver | null = null

  constructor(deps: SaveServiceDeps) {
    this.deps = deps
  }

  setPostSaver(fn: PostSaver | null): void {
    this.postSaver = fn
  }

  /** Destinataire des morceaux d'un téléchargement proxifié (`media.fetch`). */
  registerChunkSink(jobId: string, fn: (m: MediaChunkMessage) => void): () => void {
    this.sinks.set(jobId, fn)
    return () => this.sinks.delete(jobId)
  }

  private lib(): LibraryContext {
    return this.deps.ingestDeps().lib
  }

  async save(req: SaveRequest): Promise<SaveAck> {
    let deps: IngestDeps
    try {
      deps = this.deps.ingestDeps()
    } catch {
      return { status: 'error', error: 'Aucune bibliothèque ouverte.' }
    }
    const collectionUuid =
      req.collectionId && deps.lib.repos.collections.getByUuid(req.collectionId)
        ? req.collectionId
        : null
    try {
      let res: IngestResult
      if (req.kind === 'post') {
        if (!this.postSaver) throw new AppError('unsupported', 'Synchronisation indisponible.')
        res = await this.postSaver(req, collectionUuid)
      } else {
        let uploadPath: string | undefined
        if (req.upload) {
          const up = this.uploads.get(req.upload.id)
          if (!up?.done || up.failed) throw new AppError('validation', 'Envoi incomplet.')
          this.uploads.delete(req.upload.id)
          uploadPath = up.abs
        }
        res = await ingestExtension(
          req,
          {
            ...(collectionUuid ? { collectionUuid } : {}),
            ...(req.note ? { notes: req.note } : {}),
          },
          deps,
          uploadPath,
        )
      }
      const name = collectionUuid
        ? (deps.lib.repos.collections.getByUuid(collectionUuid)?.name ?? undefined)
        : undefined
      return {
        status: res.status === 'created' ? 'saved' : 'duplicate',
        saveId: res.itemUuid,
        ...(name ? { collectionName: name } : {}),
      }
    } catch (err) {
      const e = err as { code?: string; message?: string }
      this.deps.log.warn(`[bridge] enregistrement refusé : ${e.code ?? 'erreur'}`)
      return { status: 'error', error: e.message ?? 'Enregistrement impossible.' }
    }
  }

  /** Morceau d'un envoi découpé (`upload.id`) ou d'un téléchargement proxifié. */
  async chunk(m: MediaChunkMessage): Promise<void> {
    const sink = this.sinks.get(m.jobId)
    if (sink) {
      sink(m)
      return
    }
    let up = this.uploads.get(m.jobId)
    if (!up) {
      if (m.seq !== 0) return
      const abs = this.lib().paths.abs(rel.tmp(`upload-${m.jobId.replace(/[^\w-]/g, '')}.part`))
      await mkdir(path.dirname(abs), { recursive: true })
      up = {
        abs,
        stream: createWriteStream(abs),
        nextSeq: 0,
        bytes: 0,
        done: false,
        failed: null,
        startedAt: (this.deps.now ?? Date.now)(),
      }
      this.uploads.set(m.jobId, up)
    }
    if (up.failed || up.done) return
    if (m.error) up.failed = m.error
    else if (m.seq !== up.nextSeq) up.failed = 'ordre des morceaux'
    if (up.failed) {
      up.stream.destroy()
      await rm(up.abs, { force: true })
      return
    }
    const buf = Buffer.from(m.data, 'base64')
    up.bytes += buf.length
    if (up.bytes > MAX_UPLOAD_BYTES) {
      up.failed = 'trop volumineux'
      up.stream.destroy()
      await rm(up.abs, { force: true })
      return
    }
    up.nextSeq += 1
    const stream = up.stream
    if (!stream.write(buf)) await new Promise<void>((r) => stream.once('drain', r))
    if (m.last) {
      await new Promise<void>((resolve, reject) =>
        stream.end((err?: Error | null) => (err ? reject(err) : resolve())),
      )
      up.done = true
    }
  }

  /** Purge des envois abandonnés (> 10 min). */
  async sweep(): Promise<void> {
    const now = (this.deps.now ?? Date.now)()
    for (const [id, up] of this.uploads) {
      if (now - up.startedAt < 600_000) continue
      this.uploads.delete(id)
      up.stream.destroy()
      await rm(up.abs, { force: true })
    }
  }

  collections(): BridgeCollection[] {
    let lib: LibraryContext
    try {
      lib = this.lib()
    } catch {
      return []
    }
    const rows = collectionRows(lib.db)
    const byId = new Map(rows.map((r) => [r.id, r.uuid]))
    return rows
      .slice()
      .sort((a, b) => (b.viewed_at ?? b.updated_at) - (a.viewed_at ?? a.updated_at))
      .map((r) => ({
        id: r.uuid,
        name: r.name,
        color: r.color,
        parentId: r.parent_id === null ? null : (byId.get(r.parent_id) ?? null),
        count: r.count,
      }))
  }

  createCollection(name: string, color?: string): string {
    const c = this.lib().repos.collections.create({ name, ...(color ? { color } : {}) })
    emitCollectionsChanged([c.uuid])
    return c.uuid
  }
}
