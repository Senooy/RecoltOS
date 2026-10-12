/**
 * Chemins du pont extension ↔ app. Sans import `electron` : testable sous Node.
 * Tout dépend de `userData` (jamais d'un chemin `~/Library/Application Support/RecoltOS` codé en dur).
 */
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { SOCKET_PATH_MAX_BYTES, SOCKET_PREFIX } from '../../shared/bridge/constants'

/**
 * `os.tmpdir()/recolt-<sha1(userData)[0:10]>.sock` (< 104 octets, limite `sun_path`). Un `TMPDIR`
 * trop long retombe sur `/tmp` (toujours court) : le chemin reste propre à la bibliothèque.
 */
export function socketPath(userData: string, tmp: string = os.tmpdir()): string {
  const name = `${SOCKET_PREFIX}${createHash('sha1').update(userData).digest('hex').slice(0, 10)}.sock`
  const p = path.join(tmp, name)
  return Buffer.byteLength(p) <= SOCKET_PATH_MAX_BYTES ? p : path.join('/tmp', name)
}

export const inboxDir = (userData: string) => path.join(userData, 'inbox')
export const wrapperDir = (userData: string) => path.join(userData, 'native-host')
export const wrapperPath = (userData: string, browserId: string) =>
  path.join(wrapperDir(userData), `recoltos-host-${browserId}`)
export const hostJsonPath = (userData: string) => path.join(userData, 'host.json')
export const installedHostsPath = (userData: string) => path.join(userData, 'native-hosts.json')
export const installedExtensionDir = (userData: string) => path.join(userData, 'extension')

/** Exécutable SEA : `Contents/Resources/native-host/recolt-host` (packagé), `out/native-host/` (dev). */
export function hostExecutablePath(opts: {
  isPackaged: boolean
  resourcesPath: string
  appRoot: string
}): string {
  return opts.isPackaged
    ? path.join(opts.resourcesPath, 'native-host', 'recolt-host')
    : path.join(opts.appRoot, 'out', 'native-host', 'recolt-host')
}

/** Extension buildée embarquée : `Contents/Resources/extension/<cible>` ou `dist-extension/<cible>`. */
export function bundledExtensionDir(
  target: 'chromium' | 'firefox',
  opts: { isPackaged: boolean; resourcesPath: string; appRoot: string },
): string {
  return opts.isPackaged
    ? path.join(opts.resourcesPath, 'extension', target)
    : path.join(opts.appRoot, 'dist-extension', target)
}
