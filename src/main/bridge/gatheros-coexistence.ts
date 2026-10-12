/**
 * GatherOS detection: app present (existence of the bundle only,
 * no internal file opened), running processes, native manifests `co.gatheros.host.json`
 * (EXISTENCE only: never read, modified nor deleted) and the three sync flags of its
 * settings (importer allowlist; the extension token is never read).
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { gatherosRoot, readGatherosPrefs } from '../importers/gatheros/detect'
import { isGatherOSRunning } from '../platform/process-check'
import { BROWSERS, browserHostsDir } from './browsers'

export const GATHEROS_MANIFEST = 'co.gatheros.host.json'

export interface GatherOSPresence {
  appInstalled: boolean
  appRunning: boolean
  hostManifests: { browser: string; path: string }[]
  syncFlags: { x: boolean | null; instagram: boolean | null; cosmos: boolean | null } | null
}

export async function detectGatherOS(
  home: string,
  deps: {
    exists?: (p: string) => boolean
    running?: () => Promise<boolean>
    prefs?: (root: string) => Record<string, unknown>
  } = {},
): Promise<GatherOSPresence> {
  const exists = deps.exists ?? existsSync
  const appInstalled =
    exists('/Applications/GatherOS.app') || exists(path.join(home, 'Applications', 'GatherOS.app'))
  const hostManifests = BROWSERS.map((b) => ({
    browser: b.id,
    path: path.join(browserHostsDir(home, b), GATHEROS_MANIFEST),
  })).filter((m) => exists(m.path))
  const root = gatherosRoot(home)
  let syncFlags: GatherOSPresence['syncFlags'] = null
  if (exists(path.join(root, 'prefs.json'))) {
    const p = (deps.prefs ?? readGatherosPrefs)(root)
    const flag = (v: unknown) => (typeof v === 'boolean' ? v : null)
    syncFlags = {
      x: flag(p.syncXEnabled),
      instagram: flag(p.syncInstagramEnabled),
      cosmos: flag(p.syncCosmosEnabled),
    }
  }
  const appRunning = await (deps.running ?? (() => isGatherOSRunning()))().catch(() => false)
  return { appInstalled, appRunning, hostManifests, syncFlags }
}

/** Blocking warning for Instagram. */
export function blocksInstagram(p: GatherOSPresence): boolean {
  return (p.appInstalled && p.syncFlags?.instagram !== false) || p.hostManifests.length > 0
}
