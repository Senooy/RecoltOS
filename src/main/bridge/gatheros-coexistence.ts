/**
 * Détection de GatherOS : application présente (existence du bundle seulement,
 * aucun fichier interne ouvert), processus en cours, manifests natifs `co.gatheros.host.json`
 * (EXISTENCE seulement : jamais lus, modifiés ni supprimés) et les trois seuls drapeaux de sync de ses
 * réglages (liste blanche de l'importeur ; le jeton de l'extension n'est jamais lu).
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

/** Avertissement bloquant pour Instagram. */
export function blocksInstagram(p: GatherOSPresence): boolean {
  return (p.appInstalled && p.syncFlags?.instagram !== false) || p.hostManifests.length > 0
}
