/**
 * Orchestration d'une capture (SPACES §2.3, 10 étapes) : (1) verrou `inFlight` ; (2) permission
 * (prompt une fois, sinon `permission-required` sans lancer `screencapture`) ; (3) masquer la
 * fenêtre si elle existe ; (4) `screencapture` ; (5) PNG valide, sinon branche ⌃ presse-papiers
 * (image différente de celle d'avant), sinon annulation ; (6) ingestion `source:'capture'` (doublon
 * → `duplicate`) ; (7) copie dans le dossier de dépôt (échec non bloquant) ; (8) presse-papiers ;
 * (9) notification ; (10) `finally` : fenêtre restaurée, verrou levé, temporaire supprimé.
 * Toutes les dépendances Electron sont injectées (tests sans Electron).
 */
import { constants } from 'node:fs'
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CaptureResult } from '../../shared/dto/capture'
import type { CaptureMode } from '../../shared/prefs'
import { buildArgs, dropFileName, isPngFile } from './process'

export type CaptureTrigger = 'shortcut' | 'menu' | 'palette' | 'button'

export interface WindowLike {
  isDestroyed(): boolean
  isVisible(): boolean
  hide(): void
  showInactive(): void
}

export interface CaptureDeps {
  prefs: () => {
    mode: CaptureMode
    dropFolder: string | null
    hideApp: boolean
    copyToClipboard: boolean
    notify: boolean
    promptShown: boolean
  }
  access: () => { access: 'granted' | 'denied'; raw: string }
  provokePrompt: () => Promise<void>
  markPromptShown: () => void
  getWindow: () => WindowLike | null
  bin: string
  run: (bin: string, args: string[]) => Promise<{ code: number | null; stderr: string }>
  tmpDir: string
  displayIndex: () => number
  clipboard: {
    hash: () => Promise<string | null>
    png: () => Promise<Buffer | null>
    writeImage: (file: string) => Promise<void>
  }
  ingest: (
    file: string,
    collectionUuid?: string,
  ) => Promise<{ status: 'created' | 'duplicate' | 'restored' | 'dismissed'; itemUuid: string }>
  notify: (r: { itemUuid: string; duplicate: boolean } | { permission: true }) => void
  emitPermissionRequired: (access: 'granted' | 'denied') => void
  emitDone: (r: CaptureResult) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  log?: { warn: (...a: unknown[]) => void }
}

export function createCaptureService(deps: CaptureDeps) {
  let inFlight = false
  let lastDropError: string | undefined
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  async function copyToDropFolder(src: string, folder: string): Promise<string | undefined> {
    try {
      await mkdir(folder, { recursive: true })
      const at = new Date(now())
      for (let n = 1; n < 100; n++) {
        const dst = path.join(folder, dropFileName(at, n))
        try {
          await copyFile(src, dst, constants.COPYFILE_EXCL)
          lastDropError = undefined
          return dst
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
        }
      }
      throw new Error('trop de fichiers du même nom')
    } catch (err) {
      lastDropError = (err as NodeJS.ErrnoException).code ?? (err as Error).message
      deps.log?.warn('[capture] dossier de dépôt', err)
      return undefined
    }
  }

  async function run(
    o: { trigger: CaptureTrigger; mode?: CaptureMode; collectionUuid?: string } = {
      trigger: 'button',
    },
  ): Promise<CaptureResult> {
    if (inFlight) return { status: 'busy' }
    inFlight = true
    const prefs = deps.prefs()
    const mode = o.mode ?? prefs.mode
    const tmp = path.join(deps.tmpDir, `${now()}-${Math.random().toString(36).slice(2, 8)}.png`)
    let hidden: WindowLike | null = null
    try {
      // (2) Permission : jamais de capture sans `granted` (sinon : fond d'écran seul).
      let { access } = deps.access()
      if (access !== 'granted' && !prefs.promptShown) {
        await deps.provokePrompt()
        deps.markPromptShown()
        access = deps.access().access
      }
      if (access !== 'granted') {
        deps.emitPermissionRequired(access)
        const w = deps.getWindow()
        if (!w || w.isDestroyed() || !w.isVisible()) deps.notify({ permission: true })
        return { status: 'permission-required', access }
      }
      // (3) Masquer la fenêtre si elle existe et est visible.
      const w = deps.getWindow()
      if (prefs.hideApp && w && !w.isDestroyed() && w.isVisible()) {
        w.hide()
        hidden = w
        await sleep(150)
      }
      await mkdir(deps.tmpDir, { recursive: true })
      const before = mode === 'screen' ? null : await deps.clipboard.hash()
      // (4) screencapture
      const res = await deps.run(deps.bin, buildArgs(mode, tmp, deps.displayIndex()))
      // (5) Fichier PNG valide, sinon branche ⌃ (presse-papiers), sinon annulation.
      let file = tmp
      let viaClipboard = false
      if (!(await isPngFile(tmp))) {
        const after = mode === 'screen' ? null : await deps.clipboard.hash()
        const png = res.code === 0 && after && after !== before ? await deps.clipboard.png() : null
        if (!png) return { status: 'cancelled' }
        file = tmp
        await writeFile(file, png)
        viaClipboard = true
      }
      // (6) Ingestion.
      let r: Awaited<ReturnType<CaptureDeps['ingest']>>
      try {
        r = await deps.ingest(file, o.collectionUuid)
      } catch (err) {
        return { status: 'error', message: (err as Error).message || 'La capture a échoué.' }
      }
      const duplicate = r.status === 'duplicate' || r.status === 'dismissed'
      // (7) Dossier de dépôt (non bloquant).
      const dropPath = prefs.dropFolder ? await copyToDropFolder(file, prefs.dropFolder) : undefined
      // (8) Presse-papiers.
      if (prefs.copyToClipboard && !viaClipboard) {
        try {
          await deps.clipboard.writeImage(file)
        } catch (err) {
          deps.log?.warn('[capture] presse-papiers', err)
        }
      }
      const result: CaptureResult = {
        status: 'ok',
        itemUuid: r.itemUuid,
        ...(duplicate ? { duplicate: true } : {}),
        ...(viaClipboard ? { viaClipboard: true } : {}),
        ...(dropPath ? { dropPath } : {}),
      }
      // (9) Notification système si la fenêtre n'est pas visible (le toast in-app suffit sinon).
      const shown = deps.getWindow()
      const windowVisible =
        !!shown && !shown.isDestroyed() && (hidden !== null || shown.isVisible())
      if (prefs.notify && (!windowVisible || o.trigger === 'shortcut'))
        deps.notify({ itemUuid: r.itemUuid, duplicate })
      return result
    } finally {
      // (10)
      if (hidden && !hidden.isDestroyed()) hidden.showInactive()
      inFlight = false
      await rm(tmp, { force: true }).catch(() => undefined)
    }
  }

  return {
    async run(o?: { trigger: CaptureTrigger; mode?: CaptureMode; collectionUuid?: string }) {
      const r = await run(o)
      if (r.status !== 'busy') deps.emitDone(r)
      return r
    },
    get inFlight() {
      return inFlight
    },
    get lastDropError() {
      return lastDropError
    },
  }
}

export type CaptureService = ReturnType<typeof createCaptureService>
