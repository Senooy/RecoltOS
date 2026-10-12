/**
 * Initialization of the `spaces` domain: garbage collection of assets when each
 * library is opened (once per library and per launch, never during a session: cancellation
 * must be able to restore an asset), synchronous channel `spaces:applyBatchSync` reserved for
 * `beforeunload` (a single sub-batch of ≤ 2,000 nodes, same checks as `rpc`).
 */
import { ipcMain, type IpcMainEvent } from 'electron'
import { z } from 'zod'
import { AppError, formatIssues } from '../../shared/errors'
import { RAW_CHANNELS } from '../../shared/ipc/channels'
import { ApplyBatchInput } from '../../shared/ipc/spaces'
import { MAX_SYNC_BATCH } from '../../shared/spaces-schema'
import type { ServiceContext } from '../bootstrap/context'
import { emitEvent } from '../events'
import { makeSenderCheck } from '../ipc/router'
import {
  getActiveLibrary,
  registerLibraryLifecycle,
  type LibraryContext,
} from '../library/library-context'
import { rendererIndexPath } from '../windows/main-window'
import { gcSpaceAssets } from './gc'
import { applyBatch } from './repo'
import { mt } from '../i18n'

const SyncInput = ApplyBatchInput.extend({
  upsert: ApplyBatchInput.shape.upsert.max(MAX_SYNC_BATCH),
  delete: ApplyBatchInput.shape.delete.max(MAX_SYNC_BATCH),
})

export function initSpaces(ctx: ServiceContext): () => void {
  const collected = new Set<string>()
  const gc = (lib: LibraryContext) => {
    if (collected.has(lib.id)) return
    collected.add(lib.id)
    void gcSpaceAssets(lib)
      .then((r) => {
        if (r.removed > 0) ctx.log.info(`[spaces] ${r.removed} orphaned asset(s) deleted`)
      })
      .catch((err: unknown) => ctx.log.warn('[spaces] garbage collection failed', err))
  }
  const offLifecycle = registerLibraryLifecycle('spaces', { afterOpen: gc })
  const active = getActiveLibrary()
  if (active) gc(active)

  const allowed = makeSenderCheck({
    rendererUrl: ctx.flags.rendererUrl,
    rendererIndexPath: rendererIndexPath(),
  })
  const onSync = (e: IpcMainEvent, payload: unknown) => {
    try {
      if (!allowed(e.senderFrame?.url))
        throw new AppError('forbidden_sender', 'expéditeur non autorisé')
      const lib = getActiveLibrary()
      if (!lib) throw new AppError('library_unavailable', mt().errors.noLibrary)
      const parsed = SyncInput.safeParse(payload)
      if (!parsed.success) throw new AppError('validation', formatIssues(parsed.error.issues))
      const data = applyBatch(lib, parsed.data)
      emitEvent('spaces.changed', { uuids: [parsed.data.spaceUuid] })
      e.returnValue = { ok: true, data }
    } catch (err) {
      const shape =
        err instanceof AppError
          ? err.toJSON()
          : err instanceof z.ZodError
            ? { code: 'validation', message: formatIssues(err.issues) }
            : { code: 'internal', message: err instanceof Error ? err.message : String(err) }
      ctx.log.warn('[spaces] applyBatchSync', shape)
      e.returnValue = { ok: false, error: shape }
    }
  }
  // Outside Electron (registry tests), `ipcMain` does not exist.
  const ipc = ipcMain as typeof ipcMain | undefined
  ipc?.on(RAW_CHANNELS.applyBatchSync, onSync)
  return () => {
    offLifecycle()
    ipc?.removeListener(RAW_CHANNELS.applyBatchSync, onSync)
  }
}
