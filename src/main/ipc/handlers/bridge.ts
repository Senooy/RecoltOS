/**
 * Handlers `bridge.*` : clients connectés, navigateurs, extension embarquée,
 * coexistence GatherOS, (dés)installation des manifests natifs.
 */
import { shell } from 'electron'
import { existsSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EXTENSION_ID, EXTENSION_VERSION, GECKO_ID } from '../../../shared/bridge/constants'
import type { BridgeClient } from '../../../shared/dto/sync'
import { AppError } from '../../../shared/errors'
import { BROWSERS, browserLabel, isAppInstalled } from '../../bridge/browsers'
import { blocksInstagram, detectGatherOS } from '../../bridge/gatheros-coexistence'
import { reinstallHosts } from '../../bridge/init'
import { hostInstalledIn, uninstallNativeHosts } from '../../bridge/native-host-installer'
import { bundledExtensionDir, installedExtensionDir } from '../../bridge/paths'
import { getBridgeRuntime, type BridgeRuntime } from '../../bridge/runtime'
import type { BridgeClient as ServerClient } from '../../bridge/server'
import type { DomainHandlers } from '../router'
import { mt } from '../../i18n'

export function clientDto(c: ServerClient, stale: boolean): BridgeClient {
  const state = (p: 'x' | 'instagram' | 'cosmos') => {
    const s = c.platforms?.[p]
    return {
      loggedIn: s?.loggedIn ?? false,
      permission: s?.permission ?? null,
      handle: s?.handle ?? null,
    }
  }
  return {
    browser: c.browser,
    label: browserLabel(c.browser, c.browserName),
    target: c.target,
    extVersion: c.extVersion,
    connectedAt: c.connectedAt,
    profileId: c.profileId,
    platforms: c.platforms
      ? { x: state('x'), instagram: state('instagram'), cosmos: state('cosmos') }
      : null,
    stale,
  }
}

export function bridgeClients(rt: BridgeRuntime | null = getBridgeRuntime()): BridgeClient[] {
  if (!rt) return []
  return rt.server.clients().map((c) => clientDto(c, rt.stale.has(c.connId)))
}

function home(): string {
  return getBridgeRuntime()?.home ?? os.homedir()
}

/** Extension Firefox signée la plus récente (`dist-extension/signed/*.xpi` ou embarquée). */
function signedXpi(rt: BridgeRuntime): string | null {
  const dirs = rt.isPackaged
    ? [path.join(rt.resourcesPath, 'extension')]
    : [path.join(rt.appRoot, 'dist-extension', 'signed')]
  for (const d of dirs) {
    try {
      const xpi = readdirSync(d)
        .filter((n) => n.endsWith('.xpi'))
        .sort()
        .pop()
      if (xpi) return path.join(d, xpi)
    } catch {
      // dossier absent
    }
  }
  return null
}

export const bridgeHandlers: DomainHandlers<'bridge'> = {
  'bridge.getClients': () => bridgeClients(),

  'bridge.getBrowsers': async () => {
    const rt = getBridgeRuntime()
    const h = home()
    const name = rt?.hostName ?? 'com.recoltos.host'
    const hosted = hostInstalledIn(h, name)
    return Promise.all(
      BROWSERS.map(async (b) => ({
        id: b.id,
        name: b.label,
        kind: b.kind,
        installed: await isAppInstalled(b, h),
        hostInstalled: hosted.has(b.id),
        unverified: b.unverified === true,
      })),
    )
  },

  'bridge.getGatherOSPresence': async () => {
    const p = await detectGatherOS(home())
    return { ...p, blocksInstagram: blocksInstagram(p) }
  },

  'bridge.getExtensionInfo': () => {
    const rt = getBridgeRuntime()
    const dir = (t: 'chromium' | 'firefox') => {
      if (!rt) return null
      const installed = path.join(installedExtensionDir(rt.userData), t)
      if (existsSync(path.join(installed, 'manifest.json'))) return installed
      const bundled = bundledExtensionDir(t, rt)
      return existsSync(path.join(bundled, 'manifest.json')) ? bundled : null
    }
    return {
      bundledVersion: EXTENSION_VERSION,
      extensionId: EXTENSION_ID,
      geckoId: GECKO_ID,
      chromiumDir: dir('chromium'),
      firefoxDir: dir('firefox'),
      firefoxXpi: rt ? signedXpi(rt) : null,
    }
  },

  'bridge.reinstallHosts': async () => {
    if (!getBridgeRuntime()) throw new AppError('bridge_unavailable', mt().errors.bridgeStopped)
    return { installed: await reinstallHosts() }
  },

  'bridge.uninstallHosts': () => {
    const rt = getBridgeRuntime()
    const removed = rt ? uninstallNativeHosts({ userData: rt.userData, home: rt.home }) : []
    return { removed }
  },

  'bridge.revealExtensionFolder': ({ target }) => {
    const rt = getBridgeRuntime()
    if (!rt) throw new AppError('bridge_unavailable', mt().errors.bridgeStopped)
    const xpi = target === 'firefox' ? signedXpi(rt) : null
    if (xpi) {
      shell.showItemInFolder(xpi)
      return
    }
    const installed = path.join(installedExtensionDir(rt.userData), target)
    const dir = existsSync(installed) ? installed : bundledExtensionDir(target, rt)
    if (!existsSync(dir)) throw new AppError('not_found', mt().errors.extensionNotFound)
    shell.showItemInFolder(path.join(dir, 'manifest.json'))
  },
}
