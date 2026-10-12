/**
 * Dragging out, raw `drag` channel (`ipcRenderer.send`).
 * `webContents.startDrag` must be called DURING the IPC event of `dragstart`: everything is
 * synchronous here (better-sqlite3 database, `statSync`), with no round trip to a worker.
 *
 * Icon: the 128 px PNG drawn by the renderer (`createFromDataURL`); otherwise (missing, invalid,
 * empty) `resources/drag-fallback.png`, then a system icon. The webp is never passed to
 * `nativeImage` (it cannot read it). The dragged files are the ORIGINALS (Finder copies them).
 *
 * Electron dependencies are injected (`init.ts`): testable under Node.
 */
import type { IpcMainEvent, NativeImage } from 'electron'
import { z } from 'zod'
import { Uuid } from '../shared/enums'
import { RAW_CHANNELS } from '../shared/ipc/channels'

/** Maximum selection dragged at once (beyond that, the selection is truncated). */
export const DRAG_MAX_ITEMS = 2_000
/** Max size of the icon dataURL (a 128 px PNG weighs a few tens of KB). */
export const DRAG_ICON_MAX_CHARS = 2 * 1024 * 1024
export const PNG_DATA_URL_PREFIX = 'data:image/png;base64,'
/** Fallback system icon (NSImageNameMultipleDocuments). */
export const SYSTEM_DRAG_ICON = 'NSMultipleDocuments'

/**
 * Lenient payload: only the shape (object, `uuids` array) makes validation fail. An icon
 * that is invalid (type, size) is reset to `null` and an invalid uuid is dropped, so that the
 * icon fallback chain (dataURL, `drag-fallback.png`, system icon) stays reachable.
 */
const DragPayload = z.object({
  uuids: z.array(z.unknown()),
  iconDataUrl: z.unknown().optional(),
})

export interface DragRequest {
  uuids: string[]
  iconDataUrl: string | null
}

/** PNG dataURL of reasonable size, otherwise `null` (makeDragIcon then picks the fallback). */
function sanitizeIcon(v: unknown): string | null {
  if (typeof v !== 'string') return null
  if (v.length > DRAG_ICON_MAX_CHARS || !v.startsWith(PNG_DATA_URL_PREFIX)) return null
  return v
}

/** Validates the raw channel payload (no shared zod contract for raw channels). */
export function parseDragPayload(raw: unknown): DragRequest | null {
  const r = DragPayload.safeParse(raw)
  if (!r.success) return null
  const valid = r.data.uuids.filter((u): u is string => Uuid.safeParse(u).success)
  const uuids = [...new Set(valid)].slice(0, DRAG_MAX_ITEMS)
  if (uuids.length === 0) return null
  return { uuids, iconDataUrl: sanitizeIcon(r.data.iconDataUrl) }
}

/** Subset of `nativeImage` used (injected). */
export interface NativeImageApi {
  createFromDataURL(dataUrl: string): NativeImage
  createFromPath(path: string): NativeImage
  createFromNamedImage(name: string): NativeImage
}

/** Drag icon: renderer dataURL, otherwise `fallbackPath`, otherwise system icon. */
export function makeDragIcon(
  images: NativeImageApi,
  fallbackPath: string,
  iconDataUrl: string | null,
): NativeImage {
  if (iconDataUrl) {
    try {
      const img = images.createFromDataURL(iconDataUrl)
      if (!img.isEmpty()) return img
    } catch {
      // unreadable dataURL: fallback.
    }
  }
  const fallback = images.createFromPath(fallbackPath)
  if (!fallback.isEmpty()) return fallback
  return images.createFromNamedImage(SYSTEM_DRAG_ICON)
}

export interface DragDeps {
  ipcMain: {
    on(channel: string, listener: (e: IpcMainEvent, payload: unknown) => void): unknown
    removeListener(channel: string, listener: (e: IpcMainEvent, payload: unknown) => void): unknown
  }
  /** Same origin check as the `rpc` router. */
  isAllowedSender(frameUrl: string | undefined | null): boolean
  /** Local originals of the selection (empty: nothing to drag). */
  files(uuids: readonly string[]): string[]
  icon(iconDataUrl: string | null): NativeImage
  log?: { warn(...a: unknown[]): void; error(...a: unknown[]): void }
}

/** Hooks up the `drag` channel; returns the removal function. */
export function registerDrag(deps: DragDeps): () => void {
  const listener = (e: IpcMainEvent, payload: unknown): void => {
    if (!deps.isAllowedSender(e.senderFrame?.url)) {
      deps.log?.warn('[drag] sender not authorized')
      return
    }
    const req = parseDragPayload(payload)
    if (!req) {
      deps.log?.warn('[drag] invalid payload')
      return
    }
    try {
      const files = deps.files(req.uuids)
      const [first] = files
      if (!first) return
      e.sender.startDrag({ file: first, files, icon: deps.icon(req.iconDataUrl) })
    } catch (err) {
      deps.log?.error('[drag] startDrag failed', err)
    }
  }
  deps.ipcMain.on(RAW_CHANNELS.drag, listener)
  return () => {
    deps.ipcMain.removeListener(RAW_CHANNELS.drag, listener)
  }
}
