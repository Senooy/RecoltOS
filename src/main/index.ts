/**
 * Point d'entrée du process main (PLAN §1.13, §1.26 ; QA §2). Ordre imposé :
 * userData → journal → avant-ready (schéma, open-file, instance unique) → ready → services → IPC → fenêtre.
 * Les lots n'éditent pas ce fichier : ils remplissent leur `<domaine>/init.ts` et `ipc/handlers/<domaine>.ts`.
 */
import { BrowserWindow, app, ipcMain, nativeTheme } from 'electron'
import { readFlags } from './bootstrap/env'
import { readInitialPrefs } from './bootstrap/initial-prefs'
import { initLog } from './bootstrap/log'
import { installPerfMarks } from './bootstrap/perf'
import { preReady } from './bootstrap/pre-ready'
import { installDefaultSessionPolicy, installSecurity } from './bootstrap/security'
import { initServices, type ServicesHandle } from './bootstrap/services'
import { configureUserData } from './bootstrap/user-data'
import { handlers } from './ipc/handlers'
import { makeEmitter, makeSenderCheck, registerRpc } from './ipc/router'
import {
  createMainWindow,
  getMainWindow,
  installQuitHandshake,
  rendererIndexPath,
} from './windows/main-window'

const userData = configureUserData()
const log = initLog()
const flags = readFlags()
const isDev = !app.isPackaged

const { gotLock } = preReady()

if (gotLock) {
  installSecurity()
  let services: ServicesHandle | null = null

  installQuitHandshake(async () => {
    await services?.dispose()
  })

  app.on('window-all-closed', () => {
    // macOS : fermer la dernière fenêtre ne quitte pas (raccourci global toujours actif).
    if (process.platform !== 'darwin') app.quit()
  })

  void app.whenReady().then(async () => {
    installDefaultSessionPolicy()
    nativeTheme.themeSource = readInitialPrefs(userData).theme

    const emit = makeEmitter({
      targets: () => BrowserWindow.getAllWindows().map((w) => w.webContents),
      validate: isDev,
      onError: (event, err) => log.error(`[ipc] événement ${event} invalide`, err),
    })

    registerRpc({
      ipcMain,
      handlers,
      validateOutput: isDev,
      isAllowedSender: makeSenderCheck({
        rendererUrl: flags.rendererUrl,
        rendererIndexPath: rendererIndexPath(),
      }),
      onError: (channel, err) => log.error(`[ipc] ${channel}`, err),
    })
    installPerfMarks(userData)

    services = await initServices({
      userData,
      flags,
      isPackaged: app.isPackaged,
      getMainWindow,
      emit,
      log,
    })

    createMainWindow({ userData, flags })

    app.on('activate', () => {
      if (!getMainWindow()) createMainWindow({ userData, flags })
    })
  })
}
