/**
 * `userData` isolated: called at the very start of `main/index.ts`, BEFORE
 * `requestSingleInstanceLock()` and `whenReady`.
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export function resolveUserDataPath(
  env: Record<string, string | undefined>,
  appData: string,
  isPackaged: boolean,
): string {
  return env.RECOLTOS_USER_DATA
    ? path.resolve(env.RECOLTOS_USER_DATA)
    : path.join(appData, isPackaged ? 'RecoltOS' : 'RecoltOS-dev')
}

export function configureUserData(): string {
  const p = resolveUserDataPath(process.env, app.getPath('appData'), app.isPackaged)
  // app.setPath requires an existing absolute path.
  fs.mkdirSync(p, { recursive: true })
  app.setPath('userData', p)
  // Otherwise the logs go to ~/Library/Logs/RecoltOS.
  app.setAppLogsPath(path.join(p, 'logs'))
  return p
}
