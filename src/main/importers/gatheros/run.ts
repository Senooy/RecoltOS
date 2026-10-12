/**
 * GatherOS importer: resumable phases persisted in `import_runs`
 * (snapshot → read → plan → files → items → collections → tags → tombstones → jobs → finalize).
 * Policy: "add what is missing, never overwrite, never revive".
 * No `ai.enrich`: enrichment is offered in the summary.
 * Testable under Node: hashing and cloning are injected (media-worker in the app).
 */
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { AppError } from '../../../shared/errors'
import { JOB_PRIORITY } from '../../../shared/jobs'
import type {
  ImportOptions,
  ImportPhase,
  ImportProgress,
  ImportReport,
} from '../../../shared/ipc/import'
import { snapshotPath, vacuumInto } from '../../db/migrate'
import { chunks } from '../../db/repos/util'
import { membershipKey } from '../../db/repos/tombstones'
import type { JobLogger } from '../../jobs/handlers/types'
import type { LibraryContext } from '../../library/library-context'
import { remoteKey, remoteRelFor } from '../../library/remote-index'
import { snapshotGatherosDb, type GatherosLibrary } from './detect'
import {
  mapDismissedKey,
  mapSave,
  ORIGIN,
  sourceAbs,
  STARTER_TAG,
  type MappedSave,
  type PlannedFile,
} from './map'
import { readGatheros } from './read'
import Database from 'better-sqlite3'
import { importGatherosBoards } from '../../spaces/migrate-gatheros'
import { mt } from '../../i18n'

export interface ImportDeps {
  lib: LibraryContext
  hashFile(abs: string): Promise<{ sha256: string; bytes: number }>
  cloneFile(src: string, dst: string): Promise<{ bytes: number }>
  now?: () => number
  log: JobLogger
  onProgress?: (p: ImportProgress) => void
  signal?: AbortSignal
  /** Restarts the job queue. */
  kick?: () => void
  changed?: (uuids: string[], reason: 'created') => void
  collectionsChanged?: (uuids: string[]) => void
  /** GatherOS settings on the allowlist (option `importPrefs`). */
  applyPrefs?: () => void
  /** Copy concurrency (default 4). */
  concurrency?: number
}

export interface ImportInput {
  source: GatherosLibrary
  options: ImportOptions
  /** Resume an existing run. */
  runId?: number
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AppError('cancelled', mt().errors.importCancelled)
}

function sizeOf(abs: string): number | null {
  try {
    const st = statSync(abs)
    return st.isFile() ? st.size : null
  } catch {
    return null
  }
}

export function createImportRun(
  lib: LibraryContext,
  source: GatherosLibrary,
  options: ImportOptions,
  now: number,
): number {
  return Number(
    lib.db
      .prepare(
        `INSERT INTO import_runs (kind, source_path, source_library, options, state, phase, started_at)
         VALUES ('gatheros', ?, ?, ?, 'running', 'snapshot', ?)`,
      )
      .run(source.dir, source.id, JSON.stringify(options), now).lastInsertRowid,
  )
}

export async function runGatherosImport(
  input: ImportInput,
  deps: ImportDeps,
): Promise<ImportReport> {
  const { lib, log } = deps
  const now = deps.now ?? Date.now
  const startedAt = now()
  const { options } = input
  const runId = input.runId ?? createImportRun(lib, input.source, options, startedAt)
  const counts: Record<string, number> = {}
  const inc = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n)
  const warnings: string[] = []
  const missingFiles: ImportReport['missingFiles'] = []
  let phase: ImportPhase = 'snapshot'
  const setPhase = (p: ImportPhase, done = 0, total = 0, message: string | null = null) => {
    phase = p
    lib.db
      .prepare('UPDATE import_runs SET phase = ?, progress = ? WHERE id = ?')
      .run(p, JSON.stringify({ done, total }), runId)
    deps.onProgress?.({ runId, phase: p, done, total, message })
  }
  const progress = (done: number, total: number, message: string | null = null) =>
    deps.onProgress?.({ runId, phase, done, total, message })
  const workDir = join(lib.paths.dir('import'), `gatheros-${runId}`)

  try {
    // 1. snapshot: our database (if not empty), then a consistent copy of the GatherOS database.
    setPhase('snapshot')
    if (lib.repos.items.countAll() > 0) {
      vacuumInto(lib.db, snapshotPath(lib.paths.dir('snapshots'), 'pre-import', now()))
    }
    const snap = snapshotGatherosDb(input.source.dbPath, workDir)
    checkAbort(deps.signal)

    // 2. read
    const data = readGatheros(snap.path)
    warnings.push(...data.warnings)

    // 3. plan
    setPhase('plan')
    const tombItems = options.ignoreTombstones
      ? new Set<string>()
      : lib.repos.tombstones.ids(ORIGIN, 'item')
    const tombMemberships = options.ignoreTombstones
      ? new Set<string>()
      : lib.repos.tombstones.ids(ORIGIN, 'membership')
    const thumbsAvailable = (name: string) => sizeOf(join(input.source.thumbsDir, name)) !== null
    const planned: MappedSave[] = []
    const existing = new Map<string, number>()
    for (const save of data.saves) {
      const tags = data.tagsBySave.get(save.id) ?? []
      if (options.skipStarterContent && tags.includes(STARTER_TAG)) {
        inc('skipped_starter')
        continue
      }
      if (!options.includeTrash && save.deleted_at !== null) {
        inc('excluded_trash')
        continue
      }
      if (!options.includeHidden && save.hidden_at !== null) {
        inc('excluded_hidden')
        continue
      }
      if (tombItems.has(save.id)) {
        inc('skipped_tombstone')
        continue
      }
      const mapped = mapSave(save, tags, {
        importAiFields: options.importAiFields,
        hasThumb: thumbsAvailable,
      })
      warnings.push(...mapped.warnings)
      const row = lib.repos.items.getByOrigin(ORIGIN, save.id)
      if (row) {
        existing.set(save.id, row.id)
        inc('skipped_existing')
      }
      planned.push(mapped)
    }
    checkAbort(deps.signal)

    // 4. files: APFS cloning, hashing, resume (deterministic target, same size = already copied).
    const dirs = { images: input.source.imagesDir, thumbs: input.source.thumbsDir }
    const jobsFiles: { f: PlannedFile; repairOnly: boolean; itemUuid: string }[] = []
    for (const m of planned) {
      const repairOnly = existing.has(m.item.originId)
      for (const f of m.files) jobsFiles.push({ f, repairOnly, itemUuid: m.item.uuid })
    }
    const hashes = new Map<string, { sha256: string; bytes: number }>()
    const missingMedia = new Set<string>()
    const missingPosters = new Set<string>()
    const totalFiles = jobsFiles.length
    setPhase('files', 0, totalFiles)
    let done = 0
    let cursor = 0
    const worker = async () => {
      for (;;) {
        const i = cursor++
        if (i >= jobsFiles.length) return
        checkAbort(deps.signal)
        const { f, repairOnly, itemUuid } = jobsFiles[i]!
        const src = sourceAbs(dirs, f)
        const dst = lib.paths.abs(f.dstRel)
        const srcSize = sizeOf(src)
        if (srcSize === null) {
          if (f.kind === 'poster') {
            missingPosters.add(f.mediaUuid)
            inc('posters_missing')
          } else if (f.kind !== 'legacyThumb') {
            missingMedia.add(f.mediaUuid)
            missingFiles.push({ itemUuid, file: f.srcName })
            inc('files_missing')
          }
        } else {
          const dstSize = sizeOf(dst)
          if (dstSize !== srcSize) {
            await mkdir(dirname(dst), { recursive: true })
            await deps.cloneFile(src, dst)
            inc(
              f.kind === 'legacyThumb' ? 'legacy_thumbs' : repairOnly ? 'files_repaired' : 'files',
            )
            if (f.kind === 'poster' && !repairOnly) inc('posters')
          } else {
            inc(f.kind === 'legacyThumb' ? 'legacy_thumbs_skipped' : 'files_skipped')
          }
          if (!repairOnly && (f.kind === 'main' || f.kind === 'slide')) {
            hashes.set(f.mediaUuid, await deps.hashFile(dst))
          }
        }
        done++
        if (done % 10 === 0 || done === totalFiles) progress(done, totalFiles, f.srcName)
      }
    }
    await Promise.all(Array.from({ length: deps.concurrency ?? 4 }, () => worker()))
    lib.db.prepare("UPDATE import_runs SET state = 'files_done' WHERE id = ?").run(runId)
    checkAbort(deps.signal)

    // 5. items (+ authors): batches of 100 per transaction, `created_at` ascending order.
    const toCreate = planned.filter((m) => !existing.has(m.item.originId))
    const itemIds = new Map<string, number>(existing)
    const createdUuids: string[] = []
    setPhase('items', 0, toCreate.length)
    let n = 0
    for (const batch of chunks(toCreate, 100)) {
      checkAbort(deps.signal)
      lib.db.transaction(() => {
        for (const m of batch) {
          const authorId = m.author ? lib.repos.authors.upsert(m.author, now()) : null
          if (m.quotedAuthor) lib.repos.authors.upsert(m.quotedAuthor, now())
          const media = m.media.map((md) => {
            const h = hashes.get(md.uuid)
            const missing = missingMedia.has(md.uuid)
            return {
              ...md,
              status: missing ? ('missing' as const) : md.status,
              contentHash: h?.sha256 ?? null,
              fileSize: h?.bytes ?? md.fileSize ?? null,
              posterRel: md.posterRel && !missingPosters.has(md.uuid) ? md.posterRel : null,
            }
          })
          const r = lib.repos.items.upsertByOrigin({ ...m.item, authorId }, media, {
            respectTombstones: !options.ignoreTombstones,
          })
          if (r.status === 'created' && r.id !== null) {
            itemIds.set(m.item.originId, r.id)
            createdUuids.push(m.item.uuid)
            inc('items')
            inc(`kind_${m.item.kind}`)
            inc(`source_${m.item.source ?? 'local'}`)
            inc('media', media.length)
            inc('media_remote', media.filter((x) => x.status === 'remote').length)
            if (m.item.aiState === 'done') inc('ai_done')
            if (m.item.postMeta === null && m.item.kind === 'tweet') inc('posts_without_meta')
          } else if (r.status === 'tombstoned') {
            inc('skipped_tombstone')
          }
        }
      })()
      n += batch.length
      progress(n, toCreate.length)
    }
    counts.authors = (
      lib.db
        .prepare(
          "SELECT count(DISTINCT author_id) AS n FROM items WHERE origin = 'gatheros' AND author_id IS NOT NULL",
        )
        .get() as { n: number }
    ).n

    // 6. collections: flat insertion, then parents and covers; memberships (excluding tombstones).
    setPhase('collections', 0, data.collections.length)
    const colIds = new Map<string, number>()
    const createdCols: string[] = []
    lib.db.transaction(() => {
      for (const c of data.collections) {
        const r = lib.repos.collections.upsertByOrigin(
          {
            uuid: c.id.toLowerCase(),
            name: c.name.trim() || 'Sans titre',
            color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color.toLowerCase() : '#007aff',
            orderIndex: Number(c.order_index) || 0,
            origin: ORIGIN,
            originId: c.id,
            createdAt: c.created_at,
            updatedAt: c.created_at,
          },
          { respectTombstones: !options.ignoreTombstones },
        )
        if (r.id !== null) colIds.set(c.id, r.id)
        if (r.status === 'created' && r.uuid) {
          createdCols.push(r.uuid)
          inc('collections')
        } else if (r.status === 'tombstoned') inc('collections_tombstoned')
      }
      for (const c of data.collections) {
        const id = colIds.get(c.id)
        if (id === undefined || !createdCols.includes(c.id.toLowerCase())) continue
        const parent = c.parent_id ? colIds.get(c.parent_id) : undefined
        if (parent !== undefined) lib.repos.collections.setParent(id, parent)
        const cover = c.cover_save_id ? itemIds.get(c.cover_save_id) : undefined
        if (cover !== undefined) lib.repos.collections.update(id, { coverItemId: cover })
      }
      const insert = lib.db.prepare(
        'INSERT OR IGNORE INTO collection_items (collection_id, item_id, added_at) VALUES (?, ?, ?)',
      )
      for (const ci of data.collectionItems) {
        const cid = colIds.get(ci.collection_id)
        const iid = itemIds.get(ci.save_id)
        if (cid === undefined || iid === undefined) continue
        if (tombMemberships.has(membershipKey(ci.collection_id, ci.save_id))) {
          inc('memberships_tombstoned')
          continue
        }
        if (insert.run(cid, iid, ci.added_at).changes > 0) inc('memberships')
      }
    })()
    checkAbort(deps.signal)

    // 7. tags: only for created items (never overwritten).
    setPhase('tags')
    lib.db.transaction(() => {
      for (const m of toCreate) {
        const id = itemIds.get(m.item.originId)
        if (id === undefined || m.tags.length === 0 || !createdUuids.includes(m.item.uuid)) continue
        try {
          lib.repos.tags.addToItems([id], m.tags, 'import', now())
          inc('tag_links', m.tags.length)
        } catch (err) {
          warnings.push(
            `${m.item.originId} : tag refusé (${err instanceof Error ? err.message : 'erreur'})`,
          )
        }
      }
    })()
    counts.tags = (
      lib.db
        .prepare(
          `SELECT count(DISTINCT t.id) AS n FROM tags t JOIN item_tags it ON it.tag_id = t.id
           JOIN items i ON i.id = it.item_id WHERE i.origin = 'gatheros'`,
        )
        .get() as { n: number }
    ).n

    // 8. rejected items (`dismissed_tweets`) and `sync_items` pre-fill.
    setPhase('tombstones')
    lib.db.transaction(() => {
      const ins = lib.db.prepare(
        'INSERT OR IGNORE INTO sync_dismissed (source, external_id, dismissed_at) VALUES (?, ?, ?)',
      )
      for (const d of data.dismissed) {
        const k = mapDismissedKey(d.tweet_key)
        if (ins.run(k.source, k.externalId, d.dismissed_at).changes > 0) inc('sync_dismissed')
      }
      for (const m of planned) {
        const id = itemIds.get(m.item.originId)
        const src = m.item.source
        if (id === undefined || !m.item.externalId) continue
        if (src !== 'x' && src !== 'instagram' && src !== 'cosmos') continue
        lib.repos.sync.upsertItem({ source: src, externalId: m.item.externalId, itemId: id }, now())
        inc('sync_items')
      }
    })()

    // 8 bis. boards → spaces: tolerant, idempotent per `origin_id`.
    {
      const legacy = new Database(snap.path, { readonly: true, fileMustExist: true })
      try {
        const b = importGatherosBoards(legacy, lib, {
          itemIdOf: (saveId) => itemIds.get(saveId),
          now,
          log: (m) => log.warn(m),
        })
        if (b.spaces > 0) inc('spaces', b.spaces)
        if (b.nodes > 0) inc('space_nodes', b.nodes)
        if (b.skipped > 0) {
          inc('space_nodes_skipped', b.skipped)
          warnings.push(`${b.skipped} élément(s) de board ignoré(s)`)
        }
      } finally {
        legacy.close()
      }
    }

    // 9. jobs (no AI): remote downloads and avatars at high priority, derivatives afterwards.
    setPhase('jobs')
    lib.db.transaction(() => {
      const jobs = lib.repos.jobs
      const rows = lib.db
        .prepare(
          `SELECT m.id, m.item_id, m.status FROM item_media m JOIN items i ON i.id = m.item_id
           WHERE i.origin = 'gatheros' AND m.status IN ('processing', 'remote') ORDER BY i.created_at DESC, m.position`,
        )
        .all() as { id: number; item_id: number; status: string }[]
      for (const r of rows) {
        if (r.status === 'remote') {
          jobs.enqueue({
            type: 'media.download',
            itemId: r.item_id,
            dedupeKey: `dl:${r.id}`,
            payload: { mediaId: r.id },
            priority: JOB_PRIORITY.IMPORT_HIGH,
          })
          inc('jobs_download')
        } else {
          jobs.enqueue({
            type: 'media.derive',
            itemId: r.item_id,
            dedupeKey: `media:${r.id}`,
            payload: { mediaId: r.id },
            priority: JOB_PRIORITY.BATCH,
          })
          inc('jobs_derive')
        }
      }
      for (const a of lib.repos.authors.needingAvatar(100_000)) {
        jobs.enqueue({
          type: 'avatar.fetch',
          dedupeKey: `author:${a.id}`,
          payload: { authorId: a.id },
          priority: JOB_PRIORITY.IMPORT_HIGH,
        })
        inc('jobs_avatar')
      }
      for (const m of planned) {
        for (const url of m.remoteImages) {
          if (remoteRelFor(lib.root, url)) continue
          jobs.enqueue({
            type: 'remote.fetch',
            dedupeKey: `remote:${remoteKey(url)}`,
            payload: { url, itemUuid: m.item.uuid },
            priority: JOB_PRIORITY.BATCH,
          })
          inc('jobs_remote')
        }
      }
    })()
    deps.kick?.()

    // 10. finalize
    setPhase('finalize')
    lib.repos.search.optimize()
    lib.db.exec('ANALYZE')
    if (options.importPrefs) deps.applyPrefs?.()
    const byUrl = new Map<string, string[]>()
    for (const m of planned) {
      if (!m.item.sourceUrl) continue
      const list = byUrl.get(m.item.sourceUrl) ?? []
      list.push(m.item.uuid)
      byUrl.set(m.item.sourceUrl, list)
    }
    const urlDuplicates = [...byUrl]
      .filter(([, l]) => l.length > 1)
      .map(([url, itemUuids]) => ({ url, itemUuids }))
    counts.url_duplicates = urlDuplicates.length
    const missingDescription = (
      lib.db
        .prepare(
          `SELECT count(*) AS n FROM items WHERE origin = 'gatheros' AND deleted_at IS NULL
           AND ai_description IS NULL AND ai_excluded = 0`,
        )
        .get() as { n: number }
    ).n
    const finishedAt = now()
    const reportRel = `import/report-${finishedAt}.json`
    const report: ImportReport = {
      runId,
      state: 'done',
      startedAt,
      finishedAt,
      counts,
      warnings,
      error: null,
      missingFiles,
      urlDuplicates,
      missingDescription,
      reportRel,
    }
    mkdirSync(lib.paths.dir('import'), { recursive: true })
    writeFileSync(lib.paths.abs(reportRel), JSON.stringify(report, null, 2))
    lib.db
      .prepare(
        "UPDATE import_runs SET state = 'done', phase = 'done', report = ?, finished_at = ? WHERE id = ?",
      )
      .run(JSON.stringify(report), finishedAt, runId)
    rmSync(workDir, { recursive: true, force: true })
    setPhase('done', 1, 1)
    deps.changed?.(createdUuids, 'created')
    deps.collectionsChanged?.(createdCols)
    log.info(
      `[import] GatherOS: ${counts.items ?? 0} items created, ${counts.skipped_existing ?? 0} already present`,
    )
    return report
  } catch (err) {
    const cancelled = err instanceof AppError && err.code === 'cancelled'
    const finishedAt = now()
    const report: ImportReport = {
      runId,
      state: cancelled ? 'cancelled' : 'failed',
      startedAt,
      finishedAt,
      counts,
      warnings,
      error: err instanceof Error ? err.message : 'erreur inconnue',
      missingFiles,
      urlDuplicates: [],
      missingDescription: 0,
      reportRel: null,
    }
    lib.db
      .prepare('UPDATE import_runs SET state = ?, report = ?, finished_at = ? WHERE id = ?')
      .run(report.state, JSON.stringify(report), finishedAt, runId)
    rmSync(workDir, { recursive: true, force: true })
    throw err
  }
}

/** Last report (`import.gatheros.lastReport`). */
export function lastImportReport(lib: LibraryContext): ImportReport | null {
  const row = lib.db
    .prepare(
      "SELECT report FROM import_runs WHERE kind = 'gatheros' AND report IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
    .get() as { report: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.report) as ImportReport
  } catch {
    return null
  }
}

/** Interrupted import (crash during a run): `state IN ('running','files_done')`. */
export function pendingImport(
  lib: LibraryContext,
): { runId: number; phase: string | null; options: ImportOptions; source: string | null } | null {
  const row = lib.db
    .prepare(
      `SELECT id, phase, options, source_library FROM import_runs WHERE kind = 'gatheros'
       AND state IN ('running', 'files_done') ORDER BY id DESC LIMIT 1`,
    )
    .get() as
    { id: number; phase: string | null; options: string; source_library: string | null } | undefined
  if (!row) return null
  let options: ImportOptions
  try {
    options = JSON.parse(row.options) as ImportOptions
  } catch {
    return null
  }
  return { runId: row.id, phase: row.phase, options, source: row.source_library }
}
