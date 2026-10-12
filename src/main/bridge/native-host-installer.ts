/**
 * Manifests native messaging. Sans `electron`.
 *
 * - Le manifest pointe DIRECTEMENT sur l'exécutable SEA (Chromium ne lance pas un script
 *   shell comme hôte). L'hôte trouve le socket et le spool dans `<userData>/host.json`, réécrit par
 *   l'app à chaque lancement ; il n'y a plus de wrapper `sh`.
 * - Les manifests ne sont écrits que si l'appelant l'autorise (app packagée, `RECOLTOS_INSTALL_DEV_HOST=1`
 *   ou `RECOLTOS_HOME` de test) et seulement si le dossier de données du navigateur existe (Firefox :
 *   aussi si l'application est installée). Écriture atomique (`.tmp` puis `rename`).
 * - Désinstallation : seuls les fichiers `com.recoltos.host*.json` listés dans `native-hosts.json` ou
 *   présents aux emplacements connus sont supprimés. `co.gatheros.host.json` n'est JAMAIS touché.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  CHROMIUM_EXTENSION_ORIGINS,
  FIREFOX_EXTENSION_IDS,
  NATIVE_HOST_NAME,
  NATIVE_HOST_NAME_DEV,
} from '../../shared/bridge/constants'
import { BROWSERS, browserDataDir, browserHostsDir, type BrowserDef } from './browsers'
import { installedHostsPath, wrapperDir } from './paths'

export interface HostPaths {
  userData: string
  /** Exécutable SEA de l'hôte (dans l'app packagée ou `out/native-host/`). */
  hostExe: string
}

export function manifestFor(
  b: Pick<BrowserDef, 'kind'>,
  name: string,
  hostExe: string,
): Record<string, unknown> {
  const base = {
    name,
    description: 'RecoltOS : pont entre l’extension et l’application',
    path: hostExe,
    type: 'stdio',
  }
  return b.kind === 'firefox'
    ? { ...base, allowed_extensions: [...FIREFOX_EXTENSION_IDS] }
    : { ...base, allowed_origins: [...CHROMIUM_EXTENSION_ORIGINS] }
}

function writeAtomic(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, content)
  renameSync(tmp, file)
}

export interface InstalledHosts {
  name: string
  manifests: { browser: string; path: string }[]
}

function readInstalled(userData: string): InstalledHosts | null {
  try {
    return JSON.parse(readFileSync(installedHostsPath(userData), 'utf8')) as InstalledHosts
  } catch {
    return null
  }
}

export interface InstallOptions extends HostPaths {
  home: string
  name: string
  browsers?: readonly BrowserDef[]
  /** Applications installées (Firefox : le dossier `Mozilla/` peut ne pas exister encore). */
  installedApps?: ReadonlySet<string>
}

export function hostName(isDev: boolean): string {
  return isDev ? NATIVE_HOST_NAME_DEV : NATIVE_HOST_NAME
}

/** Écrit les manifests ; idempotent, silencieux en cas de succès. */
export function installNativeHosts(opts: InstallOptions): {
  installed: string[]
  skipped: string[]
} {
  const browsers = opts.browsers ?? BROWSERS
  // Anciens wrappers `sh` (anciennes versions) : retirés.
  rmSync(wrapperDir(opts.userData), { recursive: true, force: true })
  const installed: string[] = []
  const skipped: string[] = []
  const manifests: InstalledHosts['manifests'] = []
  for (const b of browsers) {
    const hasData = existsSync(browserDataDir(opts.home, b))
    const appHere = opts.installedApps?.has(b.id) ?? false
    if (!hasData && !(b.kind === 'firefox' && appHere)) {
      skipped.push(b.id)
      continue
    }
    const file = path.join(browserHostsDir(opts.home, b), `${opts.name}.json`)
    const content = `${JSON.stringify(manifestFor(b, opts.name, opts.hostExe), null, 2)}\n`
    try {
      if (!(existsSync(file) && readFileSync(file, 'utf8') === content)) writeAtomic(file, content)
      installed.push(b.id)
      manifests.push({ browser: b.id, path: file })
    } catch {
      skipped.push(b.id)
    }
  }
  const prev = readInstalled(opts.userData)
  const merged = new Map<string, { browser: string; path: string }>()
  for (const m of prev?.manifests ?? []) merged.set(m.path, m)
  for (const m of manifests) merged.set(m.path, m)
  writeAtomic(
    installedHostsPath(opts.userData),
    `${JSON.stringify({ name: opts.name, manifests: [...merged.values()] }, null, 2)}\n`,
  )
  return { installed, skipped }
}

/** Nom de fichier supprimable : uniquement nos manifests. */
export function isOwnManifest(file: string): boolean {
  return /^com\.recoltos\.host(\.dev)?\.json$/.test(path.basename(file))
}

/**
 * Retire nos manifests (listés + emplacements connus), les wrappers et la liste. Ne touche jamais un
 * fichier qui n'est pas `com.recoltos.host(.dev).json`.
 */
export function uninstallNativeHosts(opts: {
  userData: string
  home: string
  browsers?: readonly BrowserDef[]
}): string[] {
  const removed: string[] = []
  const candidates = new Set<string>()
  for (const m of readInstalled(opts.userData)?.manifests ?? []) candidates.add(m.path)
  for (const b of opts.browsers ?? BROWSERS) {
    for (const n of [NATIVE_HOST_NAME, NATIVE_HOST_NAME_DEV]) {
      candidates.add(path.join(browserHostsDir(opts.home, b), `${n}.json`))
    }
  }
  for (const file of candidates) {
    if (!isOwnManifest(file) || !existsSync(file)) continue
    rmSync(file, { force: true })
    removed.push(file)
  }
  rmSync(wrapperDir(opts.userData), { recursive: true, force: true })
  rmSync(installedHostsPath(opts.userData), { force: true })
  return removed
}

/** Navigateurs où notre manifest existe (affichage). */
export function hostInstalledIn(home: string, name: string, browsers = BROWSERS): Set<string> {
  return new Set(
    browsers
      .filter((b) => existsSync(path.join(browserHostsDir(home, b), `${name}.json`)))
      .map((b) => b.id),
  )
}
