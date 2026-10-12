/**
 * Registre « avant ready » (PLAN §1.26) : schéma privilégié `recolt://`, `open-file`,
 * instance unique (verrou par userData, donc par worktree en e2e).
 */
import { app, protocol } from 'electron'
import { getMainWindow } from '../windows/main-window'
import { applyMemoryBudgets } from './memory'
import { filesFromArgv, queueOpenFiles } from './open-files'

/** Doit précéder `app.whenReady()` (ARCHI §2.5). Le handler est posé par `protocol/init.ts` (WP-05). */
export const RECOLT_SCHEME = 'recolt'

export function preReady(): { gotLock: boolean } {
  // Budgets mémoire GPU (WP-71, `bootstrap/memory.ts`) : commutateurs Chromium, avant `ready`.
  applyMemoryBudgets(app.commandLine)
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RECOLT_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ])

  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    queueOpenFiles([filePath])
  })

  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return { gotLock }
  }

  app.on('second-instance', (_event, argv) => {
    const w = getMainWindow()
    if (w) {
      if (w.isMinimized()) w.restore()
      w.show()
      w.focus()
    }
    queueOpenFiles(filesFromArgv(argv, { appPath: app.getAppPath() }))
  })

  return { gotLock }
}
