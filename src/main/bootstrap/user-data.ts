/**
 * `userData` isolé (QA §2.1) : appelé tout au début de `main/index.ts`, AVANT
 * `requestSingleInstanceLock()` et `whenReady`. Jamais le dossier la référence.
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
  // app.setPath exige un chemin absolu existant.
  fs.mkdirSync(p, { recursive: true })
  app.setPath('userData', p)
  // Sinon les journaux partent dans ~/Library/Logs/RecoltOS.
  app.setAppLogsPath(path.join(p, 'logs'))
  return p
}
