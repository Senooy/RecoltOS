/**
 * Glisser vers l'extérieur (ARCHI §2.5, PLAN §1.12), canal brut `drag` (`ipcRenderer.send`).
 * `webContents.startDrag` doit être appelé PENDANT l'événement IPC du `dragstart` : tout est
 * synchrone ici (base better-sqlite3, `statSync`), sans aller-retour vers un worker.
 *
 * Icône : le PNG 128 px dessiné par le renderer (`createFromDataURL`) ; sinon (absente, invalide,
 * vide) `resources/drag-fallback.png`, puis une icône système. Le webp n'est jamais passé à
 * `nativeImage` (il ne le lit pas). Les fichiers glissés sont les ORIGINAUX (le Finder les copie).
 *
 * Les dépendances Electron sont injectées (`init.ts`) : testable sous Node.
 */
import type { IpcMainEvent, NativeImage } from 'electron'
import { z } from 'zod'
import { Uuid } from '../shared/enums'
import { RAW_CHANNELS } from '../shared/ipc/channels'

/** Sélection maximale glissée en une fois (au-delà, la sélection est tronquée). */
export const DRAG_MAX_ITEMS = 2_000
/** Taille max du dataURL d'icône (un PNG de 128 px pèse quelques dizaines de Ko). */
export const DRAG_ICON_MAX_CHARS = 2 * 1024 * 1024
export const PNG_DATA_URL_PREFIX = 'data:image/png;base64,'
/** Icône système de repli (NSImageNameMultipleDocuments). */
export const SYSTEM_DRAG_ICON = 'NSMultipleDocuments'

const DragPayload = z.object({
  uuids: z.array(Uuid).min(1),
  iconDataUrl: z
    .string()
    .max(DRAG_ICON_MAX_CHARS)
    .refine((s) => s.startsWith(PNG_DATA_URL_PREFIX), 'PNG en dataURL attendu')
    .optional()
    .nullable(),
})

export interface DragRequest {
  uuids: string[]
  iconDataUrl: string | null
}

/** Valide la charge du canal brut (pas de contrat zod partagé pour les canaux bruts). */
export function parseDragPayload(raw: unknown): DragRequest | null {
  const r = DragPayload.safeParse(raw)
  if (!r.success) return null
  return {
    uuids: [...new Set(r.data.uuids)].slice(0, DRAG_MAX_ITEMS),
    iconDataUrl: r.data.iconDataUrl ?? null,
  }
}

/** Sous-ensemble de `nativeImage` utilisé (injecté). */
export interface NativeImageApi {
  createFromDataURL(dataUrl: string): NativeImage
  createFromPath(path: string): NativeImage
  createFromNamedImage(name: string): NativeImage
}

/** Icône du glisser : dataURL du renderer, sinon `fallbackPath`, sinon icône système. */
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
      // dataURL illisible : repli.
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
  /** Même contrôle d'origine que le routeur `rpc`. */
  isAllowedSender(frameUrl: string | undefined | null): boolean
  /** Originaux locaux de la sélection (vide : rien à glisser). */
  files(uuids: readonly string[]): string[]
  icon(iconDataUrl: string | null): NativeImage
  log?: { warn(...a: unknown[]): void; error(...a: unknown[]): void }
}

/** Branche le canal `drag` ; renvoie la fonction de retrait. */
export function registerDrag(deps: DragDeps): () => void {
  const listener = (e: IpcMainEvent, payload: unknown): void => {
    if (!deps.isAllowedSender(e.senderFrame?.url)) {
      deps.log?.warn('[drag] expéditeur non autorisé')
      return
    }
    const req = parseDragPayload(payload)
    if (!req) {
      deps.log?.warn('[drag] charge invalide')
      return
    }
    try {
      const files = deps.files(req.uuids)
      const [first] = files
      if (!first) return
      e.sender.startDrag({ file: first, files, icon: deps.icon(req.iconDataUrl) })
    } catch (err) {
      deps.log?.error('[drag] échec de startDrag', err)
    }
  }
  deps.ipcMain.on(RAW_CHANNELS.drag, listener)
  return () => {
    deps.ipcMain.removeListener(RAW_CHANNELS.drag, listener)
  }
}
