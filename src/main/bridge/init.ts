/**
 * `bridge` domain: `host.json` (socket and spool read by the native
 * host, rewritten at each launch), manifests (packaged app, `RECOLTOS_INSTALL_DEV_HOST=1` or test
 * `RECOLTOS_HOME`), copy of the extension to a fixed path, `BridgeServer` (socket), `inbox/` spool,
 * extension registrations. Disabled under `RECOLTOS_E2E=1` unless `RECOLTOS_BRIDGE=1` (bridge tests).
 * `--uninstall-native-hosts`: removes the manifests, then quits.
 */
import { app } from 'electron'
import { writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BRIDGE_PROTOCOL_VERSION, EXTENSION_VERSION } from '../../shared/bridge/constants'
import { getLang, onLangChange } from '../../shared/i18n/lang'
import type { Disposer, ServiceContext } from '../bootstrap/context'
import { onCollectionsChanged } from '../events'
import { getActiveLibrary, registerLibraryLifecycle } from '../library/library-context'
import { ingestDeps } from '../ipc/handlers/ingest'
import { BROWSERS, isAppInstalled } from './browsers'
import { installExtension } from './extension-installer'
import { Inbox } from './inbox'
import { hostName, installNativeHosts, uninstallNativeHosts } from './native-host-installer'
import {
  bundledExtensionDir,
  hostExecutablePath,
  hostJsonPath,
  inboxDir,
  installedExtensionDir,
  socketPath,
} from './paths'
import { getBridgeRuntime, helloSettings, isOlderVersion, setBridgeRuntime } from './runtime'
import { SaveService } from './save-service'
import { BridgeServer } from './server'

export const UNINSTALL_FLAG = '--uninstall-native-hosts'

/** Installed browser applications (Firefox: its `Mozilla/` folder may be missing). */
export async function installedBrowserApps(home: string): Promise<Set<string>> {
  const out = new Set<string>()
  await Promise.all(
    BROWSERS.map(async (b) => {
      if (await isAppInstalled(b, home)) out.add(b.id)
    }),
  )
  return out
}

/** (Re)installs the manifests; returns the covered browsers. */
export async function reinstallHosts(): Promise<string[]> {
  const rt = getBridgeRuntime()
  if (!rt) return []
  const r = installNativeHosts({
    userData: rt.userData,
    home: rt.home,
    hostExe: rt.hostExe,
    name: rt.hostName,
    installedApps: await installedBrowserApps(rt.home),
  })
  return r.installed
}

export async function initBridge(ctx: ServiceContext): Promise<Disposer | void> {
  const home = ctx.flags.home ?? os.homedir()
  const isPackaged = ctx.isPackaged
  if (process.argv.includes(UNINSTALL_FLAG)) {
    const removed = uninstallNativeHosts({ userData: ctx.userData, home })
    ctx.log.info(`[bridge] ${removed.length} manifest(s) removed`)
    app.quit()
    return
  }
  if (ctx.flags.e2e && process.env.RECOLTOS_BRIDGE !== '1') return

  // Outside the packaged app: repository root (`out/main/index.js` → `../..`), whatever the launcher.
  const appRoot = isPackaged ? app.getAppPath() : path.resolve(__dirname, '..', '..')
  const resourcesPath = process.resourcesPath
  const pathsOpts = { isPackaged, resourcesPath, appRoot }
  const socket = socketPath(ctx.userData)
  const inbox = inboxDir(ctx.userData)
  const hostExe = hostExecutablePath(pathsOpts)
  const name = hostName(!isPackaged)
  const server = new BridgeServer(socket, ctx.log)
  await server.start()
  writeFileSync(
    hostJsonPath(ctx.userData),
    `${JSON.stringify({ socket, inbox, protocol: BRIDGE_PROTOCOL_VERSION, pid: process.pid, hostExe }, null, 2)}\n`,
  )
  const saves = new SaveService({ ingestDeps, log: ctx.log })
  setBridgeRuntime({
    server,
    saves,
    userData: ctx.userData,
    home,
    isPackaged,
    hostName: name,
    hostExe,
    socket,
    inbox,
    resourcesPath,
    appRoot,
    stale: new Set(),
  })

  // Manifests: never in dev without explicit consent; `RECOLTOS_HOME` = test folder.
  const allowManifests = isPackaged || ctx.flags.installDevHost || ctx.flags.home !== null
  if (allowManifests) {
    void reinstallHosts().catch((err: unknown) => ctx.log.warn('[bridge] manifests', err))
  }
  // Copy the bundled extension to the fixed path shown by the « Révéler le dossier » action.
  for (const target of ['chromium', 'firefox'] as const) {
    void installExtension(
      bundledExtensionDir(target, pathsOpts),
      path.join(installedExtensionDir(ctx.userData), target),
    ).catch((err: unknown) => ctx.log.warn(`[bridge] extension ${target}`, err))
  }

  const helloAck = (needsReload: boolean) => ({
    appVersion: app.getVersion(),
    protocol: BRIDGE_PROTOCOL_VERSION,
    needsReload,
    bundledExtVersion: EXTENSION_VERSION,
    settings: helloSettings(),
    lang: getLang(),
  })
  server.handle('hello', (m, client) => {
    const p = m.payload
    // In dev, never request a reload.
    const needsReload = isPackaged && isOlderVersion(p.extVersion, EXTENSION_VERSION)
    server.send(client.connId, 'hello.ack', helloAck(needsReload), m.id)
    server.send(client.connId, 'collections.list.result', { collections: saves.collections() })
  })
  server.handle('ext.stale', (_m, client) => {
    getBridgeRuntime()?.stale.add(client.connId)
  })
  server.handle('save.create', async (m, client) => {
    const ack = await saves.save(m.payload)
    server.send(client.connId, 'save.ack', ack, m.id)
  })
  server.handle('media.chunk', (m) => saves.chunk(m.payload))
  server.handle('collections.list', (m, client) => {
    server.send(
      client.connId,
      'collections.list.result',
      { collections: saves.collections() },
      m.id,
    )
  })
  server.handle('collection.create', (m, client) => {
    const p = m.payload
    const createdId = saves.createCollection(p.name, p.color)
    server.send(
      client.connId,
      'collections.list.result',
      { collections: saves.collections(), createdId },
      m.id,
    )
  })
  const offClients = server.onClients(() => {
    const rt = getBridgeRuntime()
    if (!rt) return
    const alive = new Set(server.hosts().map((c) => c.connId))
    for (const id of rt.stale) if (!alive.has(id)) rt.stale.delete(id)
  })
  const offCollections = onCollectionsChanged(() => {
    server.broadcast('collections.changed', { collections: saves.collections() })
  })
  // Language changed: `hello.ack` sent to connected extensions (except those to reload).
  const offLang = onLangChange(() => {
    const stale = getBridgeRuntime()?.stale
    for (const c of server.clients()) {
      if (stale?.has(c.connId)) continue
      server.send(c.connId, 'hello.ack', helloAck(false))
    }
  })

  const spool = new Inbox({ dir: inbox, save: (req) => saves.save(req), log: ctx.log })
  if (getActiveLibrary()) spool.start()
  const offLib = registerLibraryLifecycle('bridge', {
    afterOpen: () => {
      spool.start()
      server.broadcast('collections.changed', { collections: saves.collections() })
    },
  })
  const sweep = setInterval(() => void saves.sweep(), 60_000)
  sweep.unref()

  return async () => {
    clearInterval(sweep)
    offLib()
    offClients()
    offCollections()
    offLang()
    spool.stop()
    setBridgeRuntime(null)
    await server.stop()
  }
}
