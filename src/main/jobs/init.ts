/**
 * Domaine `jobs` (WP-10) : media-worker partagé, file de jobs persistante, services de
 * l'ingestion. Branché sur le cycle de vie des bibliothèques (`registerLibraryLifecycle`) :
 * au démarrage d'une bibliothèque, les jobs `running` repassent en `queued`, les `.part` orphelins
 * sont supprimés et les vieux jobs terminés nettoyés (ARCHI §5.3).
 */
import { net } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { AppError } from '../../shared/errors'
import { emitCollectionsChanged, emitItemsChanged, setAppEmitter } from '../events'
import { configureImportService } from '../importers/gatheros/service'
import { getLibraryManager } from '../library/init'
import type { Prefs } from '../../shared/prefs'
import type { Disposer, ServiceContext } from '../bootstrap/context'
import { capturePage } from '../ingest/page-capture'
import {
  getActiveLibrary,
  registerLibraryLifecycle,
  type LibraryContext,
} from '../library/library-context'
import { resetRemoteIndex } from '../library/remote-index'
import { mediaToolsOf, resolveBinaries, type BinPaths } from '../platform/binaries'
import { requirePrefsStore } from '../prefs/store'
import { provideMediaWorker } from '../protocol/media-worker'
import { createMediaWorker } from '../workers-host'
import { makeUtilityFork, mediaWorkerPath } from '../workers/utility-fork'
import { jobFailureHooks, jobHandlers } from './handlers'
import type { FetchFn, JobServices, MediaCaller } from './handlers/types'
import { JobQueue } from './queue'
import { createChangeBatcher, setIngestProgressEmitter, setJobRuntime } from './runtime'
import { startAutoPurge } from './auto-purge'
import { cleanupAtOpen } from './startup'

export async function initJobs(ctx: ServiceContext): Promise<Disposer | void> {
  if (typeof net?.fetch !== 'function') {
    ctx.log.warn('[jobs] hors Electron : file de jobs non démarrée')
    return
  }
  const prefsStore = requirePrefsStore()
  let bins: BinPaths = await resolveBinaries(prefsStore.get()).catch((): BinPaths => ({
    sips: '/usr/bin/sips',
  }))
  const mw = createMediaWorker({
    modulePath: mediaWorkerPath(),
    fork: makeUtilityFork(ctx.log),
    tools: mediaToolsOf(bins),
    log: ctx.log,
    onCrash: (info) => {
      ctx.log.warn(
        `[jobs] media-worker arrêté (${info.code ?? info.signal ?? '?'}), ${info.interrupted.length} appel(s) interrompu(s)${info.broken ? ', état broken' : ''}`,
      )
    },
  })
  provideMediaWorker(() => mw)

  const media: MediaCaller = (op, args, opts) => mw.call(op, args, opts)
  const fetchFn: FetchFn = (url, init) => net.fetch(url, init)
  setAppEmitter((event, payload) => ctx.emit(event, payload))
  const batcher = createChangeBatcher((p) => emitItemsChanged(p.uuids, p.reason))

  let queue: JobQueue | null = null
  const servicesFor = (): JobServices | null => {
    const lib = getActiveLibrary()
    if (!lib) return null
    return {
      lib,
      media,
      fetch: fetchFn,
      prefs: (): Prefs => prefsStore.get(),
      changed: (uuids, reason) => batcher.push(uuids, reason),
      hasTool: (name) => Boolean(bins[name]),
      kick: () => queue?.kick(),
      log: ctx.log,
    }
  }
  queue = new JobQueue({
    services: servicesFor,
    handlers: jobHandlers,
    failureHooks: jobFailureHooks,
    onStatus: (s) => ctx.emit('jobs.progress', s),
  })
  const q = queue
  setJobRuntime(q, servicesFor, capturePage)
  setIngestProgressEmitter((p) => ctx.emit('ingest.progress', p))

  let openedRoot: string | null = null
  const startFor = async (lib: LibraryContext) => {
    if (openedRoot !== lib.root) {
      openedRoot = lib.root
      resetRemoteIndex(lib.root)
      await cleanupAtOpen(lib)
    }
    q.start()
  }

  const disposeLifecycle = registerLibraryLifecycle('jobs', {
    afterOpen: (lib) => startFor(lib),
    pauseJobs: (ms) => q.pause(ms),
    resumeJobs: () => q.resume(),
  })
  const active = getActiveLibrary()
  if (active) await startFor(active)

  const offPrefs = prefsStore.onChange((next, prev) => {
    if (JSON.stringify(next.tools) === JSON.stringify(prev.tools)) return
    void resolveBinaries(next).then((b) => {
      bins = b
      return mw.setTools(mediaToolsOf(b))
    })
  })
  const stopAutoPurge = startAutoPurge({
    services: servicesFor,
    log: ctx.log,
    emitChanged: (uuids) => batcher.push(uuids, 'purged'),
  })

  configureImportService({
    home: ctx.flags.home,
    media,
    log: ctx.log,
    kick: () => q.kick(),
    emitProgress: (p) => ctx.emit('import.progress', p),
    changed: (uuids) => batcher.push(uuids, 'created'),
    collectionsChanged: (uuids) => emitCollectionsChanged(uuids),
    applyPrefs: (patch) => prefsStore.set(patch),
    createLibrary: async (name) => {
      const m = getLibraryManager()
      if (!m)
        throw new AppError('library_unavailable', 'Gestionnaire de bibliothèques indisponible.')
      await m.create({ name })
    },
    tmpDir: () => {
      const dir = join(ctx.userData, 'tmp')
      mkdirSync(dir, { recursive: true })
      return dir
    },
  })

  return async () => {
    configureImportService(null)
    setAppEmitter(null)
    stopAutoPurge()
    offPrefs()
    disposeLifecycle()
    batcher.flush()
    await q.stop()
    setJobRuntime(null, null)
    setIngestProgressEmitter(null)
    provideMediaWorker(null)
    await mw.stop()
  }
}
