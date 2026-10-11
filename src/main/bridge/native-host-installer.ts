/**
 * Wrappers et manifests native messaging (SYNC §1.4-1.5, PLAN §1.18, ERRATA §G.2). Sans `electron`.
 *
 * - Les wrappers `sh` (`<userData>/native-host/recoltos-host-<navigateur>`) sont régénérés à chaque
 *   lancement : ils exportent `RECOLTOS_SOCKET`, `RECOLTOS_INBOX`, `RECOLTOS_BROWSER` puis lancent
 *   l'exécutable SEA (code 3 s'il a disparu : l'extension affiche « RecoltOS introuvable »).
 * - Les manifests ne sont écrits que si l'appelant l'autorise (app packagée, `RECOLTOS_INSTALL_DEV_HOST=1`
 *   ou `RECOLTOS_HOME` de test) et seulement si le dossier de données du navigateur existe (Firefox :
 *   aussi si l'application est installée). Écriture atomique (`.tmp` puis `rename`).
 * - Désinstallation : seuls les fichiers `com.recoltos.host*.json` listés dans `native-hosts.json` ou
 *   présents aux emplacements connus sont supprimés. `co.gatheros.host.json` n'est JAMAIS touché.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import {
  EXTENSION_ORIGIN,
  GECKO_ID,
  NATIVE_HOST_NAME,
  NATIVE_HOST_NAME_DEV,
} from '../../shared/bridge/constants'
import { BROWSERS, browserDataDir, browserHostsDir, type BrowserDef } from './browsers'
import { installedHostsPath, wrapperDir, wrapperPath } from './paths'

export interface WrapperEnv {
  userData: string
  hostExe: string
  socket: string
  inbox: string
}

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

export function wrapperScript(browserId: string, env: WrapperEnv): string {
  return [
    '#!/bin/sh',
    `# Généré par RecoltOS — ne pas modifier. Navigateur : ${browserId}`,
    `export RECOLTOS_BROWSER=${shQuote(browserId)}`,
    `export RECOLTOS_SOCKET=${shQuote(env.socket)}`,
    `export RECOLTOS_INBOX=${shQuote(env.inbox)}`,
    `HOST=${shQuote(env.hostExe)}`,
    '[ -x "$HOST" ] || { echo "RecoltOS introuvable : $HOST" >&2; exit 3; }',
    'exec "$HOST" "$@"',
    '',
  ].join('\n')
}

export function manifestFor(
  b: Pick<BrowserDef, 'kind'>,
  name: string,
  wrapper: string,
): Record<string, unknown> {
  const base = {
    name,
    description: 'RecoltOS : pont entre l’extension et l’application',
    path: wrapper,
    type: 'stdio',
  }
  return b.kind === 'firefox'
    ? { ...base, allowed_extensions: [GECKO_ID] }
    : { ...base, allowed_origins: [EXTENSION_ORIGIN] }
}

function writeAtomic(file: string, content: string, mode?: number): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, content, mode === undefined ? undefined : { mode })
  if (mode !== undefined) chmodSync(tmp, mode)
  renameSync(tmp, file)
}

/** Régénère les wrappers de tous les navigateurs (contenu identique = pas de réécriture). */
export function writeWrappers(
  env: WrapperEnv,
  browsers: readonly BrowserDef[] = BROWSERS,
): string[] {
  mkdirSync(wrapperDir(env.userData), { recursive: true, mode: 0o700 })
  const out: string[] = []
  for (const b of browsers) {
    const p = wrapperPath(env.userData, b.id)
    const content = wrapperScript(b.id, env)
    const same = existsSync(p) && readFileSync(p, 'utf8') === content
    if (!same) writeAtomic(p, content, 0o755)
    out.push(p)
  }
  return out
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

export interface InstallOptions extends WrapperEnv {
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
  writeWrappers(opts, browsers)
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
    const content = `${JSON.stringify(manifestFor(b, opts.name, wrapperPath(opts.userData, b.id)), null, 2)}\n`
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
