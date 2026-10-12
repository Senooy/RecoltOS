/**
 * Operations table of the media-worker (`MediaOps`, `src/shared/worker-protocol.ts`).
 * Pure functions on the process side: explicit paths, no database, no `electron`.
 */
import { AppError } from '../../../shared/errors'
import type { MediaArgs, MediaOp, MediaResult } from '../../../shared/worker-protocol'
import { aiImage, extractFrame } from './ai'
import type { MediaTools } from './exec'
import { cloneFile, hashFile, toPng, zipLibrary } from './files'
import { decodeForeign } from './foreign'
import { palette } from './palette'
import { probeImage, probeVideo } from './probe'
import { makeAvatar, makeDisplay, makeLarge, makeThumb } from './thumbs'
import { makePoster, makePreview } from './video'

export interface OpContext {
  tools: MediaTools
  signal?: AbortSignal | undefined
  progress?: ((p: unknown) => void) | undefined
}

type Impl<O extends MediaOp> = (args: MediaArgs<O>, ctx: OpContext) => Promise<MediaResult<O>>

export const MEDIA_OPS: { [O in MediaOp]: Impl<O> } = {
  probeImage: (a, c) => probeImage(a, c.tools, c.signal),
  probeVideo: (a, c) => probeVideo(a, c.tools, c.signal),
  decodeForeign: (a, c) => decodeForeign(a, c.tools, c.signal),
  makeThumb: (a, c) => makeThumb(a, c.tools, c.signal),
  makeLarge: (a, c) => makeLarge(a, c.tools, c.signal),
  makePoster: (a, c) => makePoster(a, c.tools, c.signal),
  makePreview: (a, c) => makePreview(a, c.tools, c.signal),
  makeDisplay: (a, c) => makeDisplay(a, c.tools, c.signal),
  makeAvatar: (a, c) => makeAvatar(a, c.tools, c.signal),
  palette: (a, c) => palette(a, c.tools, c.signal),
  toPng: (a, c) => toPng(a, c.tools, c.signal),
  hashFile: (a) => hashFile(a),
  cloneFile: (a) => cloneFile(a),
  zipLibrary: (a, c) => zipLibrary(a, c.progress, c.signal),
  aiImage: (a, c) => aiImage(a, c.tools, c.signal),
  extractFrame: (a, c) => extractFrame(a, c.tools, c.signal),
}

export function isMediaOp(op: string): op is MediaOp {
  return Object.prototype.hasOwnProperty.call(MEDIA_OPS, op)
}

/** Runs `op`; the arguments must be an object (fine-grained validation in each op). */
export function runMediaOp(op: string, args: unknown, ctx: OpContext): Promise<unknown> {
  if (!isMediaOp(op)) return Promise.reject(new AppError('unknown_op', `unknown operation: ${op}`))
  if (typeof args !== 'object' || args === null) {
    return Promise.reject(new AppError('validation', 'arguments attendus'))
  }
  const impl = MEDIA_OPS[op] as Impl<MediaOp>
  try {
    return impl(args as never, ctx)
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)))
  }
}
