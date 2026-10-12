/**
 * Navigateurs pris en charge (Firefox) : dossier de données, dossier des
 * manifests natifs, format du manifest, détection de l'application (`mdfind` par bundle ID, puis
 * `/Applications` et `~/Applications`). Sans import `electron`.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

export type BrowserKind = 'chromium' | 'firefox'

export interface BrowserDef {
  id: string
  label: string
  kind: BrowserKind
  /** Dossier de données sous `~/Library/Application Support/`. */
  dir: string
  /** Dossier des manifests natifs sous `~/Library/Application Support/`. */
  hostsDir: string
  bundleId: string
  app: string
  unverified?: boolean
}

const chromium = (
  id: string,
  label: string,
  dir: string,
  bundleId: string,
  app: string,
  unverified = false,
): BrowserDef => ({
  id,
  label,
  kind: 'chromium',
  dir,
  hostsDir: `${dir}/NativeMessagingHosts`,
  bundleId,
  app,
  ...(unverified ? { unverified } : {}),
})

export const BROWSERS: readonly BrowserDef[] = [
  {
    id: 'firefox',
    label: 'Firefox',
    kind: 'firefox',
    dir: 'Firefox',
    // Firefox (et ses éditions Developer / Nightly) lit `Mozilla/NativeMessagingHosts`.
    hostsDir: 'Mozilla/NativeMessagingHosts',
    bundleId: 'org.mozilla.firefox',
    app: 'Firefox',
  },
  chromium('chrome', 'Chrome', 'Google/Chrome', 'com.google.Chrome', 'Google Chrome'),
  chromium(
    'chrome-beta',
    'Chrome Beta',
    'Google/Chrome Beta',
    'com.google.Chrome.beta',
    'Google Chrome Beta',
  ),
  chromium(
    'chrome-canary',
    'Chrome Canary',
    'Google/Chrome Canary',
    'com.google.Chrome.canary',
    'Google Chrome Canary',
  ),
  chromium('chromium', 'Chromium', 'Chromium', 'org.chromium.Chromium', 'Chromium'),
  chromium('brave', 'Brave', 'BraveSoftware/Brave-Browser', 'com.brave.Browser', 'Brave Browser'),
  chromium('edge', 'Edge', 'Microsoft Edge', 'com.microsoft.edgemac', 'Microsoft Edge'),
  chromium('vivaldi', 'Vivaldi', 'Vivaldi', 'com.vivaldi.Vivaldi', 'Vivaldi'),
  chromium('opera', 'Opera', 'com.operasoftware.Opera', 'com.operasoftware.Opera', 'Opera', true),
  chromium('arc', 'Arc', 'Arc/User Data', 'company.thebrowser.Browser', 'Arc', true),
  chromium('dia', 'Dia', 'Dia/User Data', 'company.thebrowser.dia', 'Dia', true),
]

export const appSupport = (home: string) => path.join(home, 'Library', 'Application Support')

export const browserDataDir = (home: string, b: BrowserDef) => path.join(appSupport(home), b.dir)
export const browserHostsDir = (home: string, b: BrowserDef) =>
  path.join(appSupport(home), b.hostsDir)

export type MdfindFn = (query: string) => Promise<string>

const defaultMdfind: MdfindFn = (query) =>
  new Promise((resolve) => {
    execFile('/usr/bin/mdfind', [query], { timeout: 5_000 }, (err, stdout) =>
      resolve(err ? '' : String(stdout)),
    )
  })

/** Application installée : `mdfind` par bundle ID, sinon `/Applications/<app>.app`, `~/Applications`. */
export async function isAppInstalled(
  b: BrowserDef,
  home: string,
  mdfind: MdfindFn = defaultMdfind,
  exists: (p: string) => boolean = existsSync,
): Promise<boolean> {
  if (!/^[A-Za-z0-9.-]+$/.test(b.bundleId)) return false
  const found = await mdfind(`kMDItemCFBundleIdentifier == '${b.bundleId}'`).catch(() => '')
  if (found.split('\n').some((l) => l.trim().endsWith('.app'))) return true
  return (
    exists(path.join('/Applications', `${b.app}.app`)) ||
    exists(path.join(home, 'Applications', `${b.app}.app`))
  )
}

/**
 * Libellé d'un client : nom du processus parent de l'hôte (« Google Chrome », « firefox »,
 * « Brave Browser »…) ou identifiant, sinon le nom annoncé par l'extension.
 */
export function browserLabel(hostBrowser: string, helloName?: string | null): string {
  const n = hostBrowser.toLowerCase()
  const b = BROWSERS.find(
    (x) => x.id === n || x.app.toLowerCase() === n || x.label.toLowerCase() === n,
  )
  if (b) return b.label
  if (helloName) {
    const h = helloName.toLowerCase()
    const byHello = BROWSERS.find((x) => h.includes(x.label.toLowerCase()))
    if (byHello) return byHello.label
    return helloName
  }
  return hostBrowser
}
