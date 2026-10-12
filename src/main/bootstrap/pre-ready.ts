/**
 * "Before ready" registry: privileged `recolt://` scheme, `open-file`,
 * single instance (lock per userData, hence per worktree in e2e).
 */
import { app, protocol } from 'electron'
import { getMainWindow } from '../windows/main-window'
import { applyMemoryBudgets } from './memory'
import { filesFromArgv, queueOpenFiles } from './open-files'

/** Must come before `app.whenReady()`. The handler is set by `protocol/init.ts`. */
export const RECOLT_SCHEME = 'recolt'

export function preReady(): { gotLock: boolean } {
  // GPU memory budgets (`bootstrap/memory.ts`): Chromium switches, before `ready`.
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
