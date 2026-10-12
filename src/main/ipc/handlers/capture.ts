/**
 * Handlers `capture.*` : lancer une capture, état (permission, raccourci,
 * signature, dernier échec du dossier de dépôt), raccourci appliqué immédiatement, volet des
 * Réglages Système, relance, choix du dossier de dépôt.
 */
import { BrowserWindow, app, dialog, type OpenDialogOptions } from 'electron'
import { getCaptureService, isShortcutRegistered, setCaptureShortcut } from '../../capture/init'
import { getScreenAccess, openPermissionPane, relaunchApp } from '../../capture/permission'
import { getSignatureKind } from '../../capture/signature'
import { requirePrefsStore } from '../../prefs/store'
import type { DomainHandlers } from '../router'
import { mt } from '../../i18n'

export const captureHandlers: DomainHandlers<'capture'> = {
  'capture.run': ({ mode, collectionUuid }) =>
    getCaptureService().run({
      trigger: 'button',
      ...(mode ? { mode } : {}),
      ...(collectionUuid ? { collectionUuid } : {}),
    }),
  'capture.status': async () => {
    const { access, raw } = getScreenAccess()
    const svc = getCaptureService()
    return {
      access,
      raw,
      shortcut: requirePrefsStore().get().capture.shortcut,
      shortcutRegistered: isShortcutRegistered(),
      signature: await getSignatureKind(app.isPackaged, app.getPath('exe')),
      ...(svc.lastDropError ? { lastDropError: svc.lastDropError } : {}),
    }
  },
  'capture.setShortcut': ({ accel, label }) => {
    const r = setCaptureShortcut(accel, label)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  },
  'capture.openPermissionPane': async () => {
    await openPermissionPane()
  },
  'capture.relaunch': () => {
    relaunchApp()
  },
  'capture.pickDropFolder': async (_input, ctx) => {
    const options: OpenDialogOptions = {
      title: mt().dialogs.dropFolder,
      buttonLabel: mt().dialogs.choose,
      properties: ['openDirectory', 'createDirectory'],
    }
    const win = ctx.sender ? BrowserWindow.fromWebContents(ctx.sender) : null
    const res = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    const folder = res.canceled ? null : (res.filePaths[0] ?? null)
    if (folder) requirePrefsStore().set({ capture: { dropFolder: folder, dropFolderInit: true } })
    return folder
  },
}
