/**
 * `sync` domain: `SyncCoordinator` plugged into the bridge (`bridge/init.ts`, registered
 * BEFORE in `services.ts`), downloader (policies per CDN), rendering of post cards,
 * posts, pre-filling after GatherOS import, timer (60 s) and `evt:sync.status`.
 * Disabled under `RECOLTOS_E2E=1` unless `RECOLTOS_BRIDGE=1`.
 */
import os from 'node:os'
import type { BridgePlatform } from '../../shared/bridge/constants'
import { newUuid } from '../../shared/ids'
import type { Disposer, ServiceContext } from '../bootstrap/context'
import { browserLabel } from '../bridge/browsers'
import { blocksInstagram, detectGatherOS } from '../bridge/gatheros-coexistence'
import { getBridgeRuntime, setHelloSettingsProvider } from '../bridge/runtime'
import { onGatherosImportDone } from '../importers/gatheros/service'
import { bridgeClients } from '../ipc/handlers/bridge'
import { getJobQueue, requireJobServices } from '../jobs/runtime'
import { getActiveLibrary, registerLibraryLifecycle } from '../library/library-context'
import { resolveBinaries } from '../platform/binaries'
import { requirePrefsStore } from '../prefs/store'
import { captureCardElectron } from './card-capture'
import { SyncCoordinator, type BridgePort } from './coordinator'
import { registerSyncFetchPolicies } from './downloader'
import { prefillAfterImport } from './import-prefill'
import { postFromRequest } from './post-from-request'
import { CardRenderQueue, pendingCardItems, renderTweetCard } from './tweet-card-renderer'

let coordinator: SyncCoordinator | null = null

export function getSyncCoordinator(): SyncCoordinator | null {
  return coordinator
}

function bridgePort(): BridgePort | null {
  const rt = getBridgeRuntime()
  if (!rt) return null
  const server = rt.server
  return {
    clients: () =>
      server.clients().map((c) => ({
        connId: c.connId,
        label: browserLabel(c.browser, c.browserName),
        loggedIn: {
          x: c.platforms?.x.loggedIn ?? false,
          instagram: c.platforms?.instagram.loggedIn ?? false,
          cosmos: c.platforms?.cosmos.loggedIn ?? false,
        },
        permission: {
          x: c.platforms?.x.permission ?? null,
          instagram: c.platforms?.instagram.permission ?? null,
          cosmos: c.platforms?.cosmos.permission ?? null,
        },
        lastSeenAt: c.lastSeenAt,
      })),
    send: (connId, type, payload, re) => server.send(connId, type, payload, re),
    broadcast: (type, payload) => server.broadcast(type, payload),
  }
}

export async function initSync(ctx: ServiceContext): Promise<Disposer | void> {
  if (ctx.flags.e2e && process.env.RECOLTOS_BRIDGE !== '1') return
  const prefs = requirePrefsStore()
  const home = ctx.flags.home ?? os.homedir()
  let ffmpeg: string | null = null
  void resolveBinaries(prefs.get())
    .then((b) => {
      ffmpeg = b.ffmpeg ?? null
    })
    .catch(() => undefined)

  let conflict = false
  const refreshConflict = async () => {
    const p = await detectGatherOS(home).catch(() => null)
    conflict = p ? p.appRunning || p.hostManifests.length > 0 || blocksInstagram(p) : false
  }
  await refreshConflict()

  const cards = new CardRenderQueue(async (itemId) => {
    const lib = getActiveLibrary()
    if (!lib) return
    const uuid = await renderTweetCard(lib, itemId, {
      media: requireJobServices().media,
      capture: captureCardElectron,
    })
    if (uuid) {
      requireJobServices().changed([uuid], 'derived')
      getJobQueue()?.kick()
    }
  })

  const c = new SyncCoordinator({
    lib: getActiveLibrary,
    bridge: bridgePort,
    prefs: () => prefs.get(),
    now: Date.now,
    emitStatus: (s) => ctx.emit('sync.status', s),
    kickJobs: () => getJobQueue()?.kick(),
    renderCards: (ids) => cards.push(ids),
    gatherosConflict: () => conflict,
    clientsDto: () => bridgeClients(),
    log: ctx.log,
    newId: newUuid,
  })
  coordinator = c
  setHelloSettingsProvider(() => c.helloSettings())
  const offPolicies = registerSyncFetchPolicies({
    ffmpeg: () => ffmpeg,
    onExpired: (url) => c.onExpiredUrl(url),
  })

  const offs: (() => void)[] = []
  const rt = getBridgeRuntime()
  if (rt) {
    const s = rt.server
    s.handle('sync.page', (m, client) => {
      s.send(client.connId, 'sync.ack', c.onPage(m.payload), m.id)
    })
    s.handle('sync.finished', (m) => c.onFinished(m.payload))
    s.handle('sync.request', (m) => {
      if (m.payload.trigger === 'manual') c.runNow(m.payload.platform)
      else c.tick()
    })
    s.handle('sync.hint', (m) => c.hint(m.payload.platform))
    s.handle('capture.passive', (m) => void c.onPassive(m.payload))
    s.handle('item.data', (m) => void c.onItemData(m.payload))
    s.handle('author.seen', (m) => c.onAuthorSeen(m.payload))
    offs.push(s.onClients(() => c.onClientsChanged()))
    rt.saves.setPostSaver((req, coll) => Promise.resolve(c.savePost(req, coll, postFromRequest)))
  }

  offs.push(
    onGatherosImportDone((lib, gp) => {
      const flag = (v: unknown) => (typeof v === 'boolean' ? v : null)
      const flags: Partial<Record<BridgePlatform, boolean | null>> = {
        x: flag(gp.syncXEnabled),
        instagram: flag(gp.syncInstagramEnabled),
        cosmos: flag(gp.syncCosmosEnabled),
      }
      prefillAfterImport(lib, flags, Date.now())
      c.publish()
    }),
  )
  offs.push(
    registerLibraryLifecycle('sync', {
      afterOpen: (lib) => {
        cards.push(pendingCardItems(lib))
        c.publish()
      },
    }),
  )
  const lib = getActiveLibrary()
  if (lib) cards.push(pendingCardItems(lib))

  const timer = setInterval(() => c.tick(), 60_000)
  timer.unref()
  const gTimer = setInterval(() => {
    void refreshConflict().then(() => c.publish())
  }, 5 * 60_000)
  gTimer.unref()
  c.tick()

  return () => {
    clearInterval(timer)
    clearInterval(gTimer)
    for (const off of offs) off()
    offPolicies()
    setHelloSettingsProvider(null)
    rt?.saves.setPostSaver(null)
    c.dispose()
    coordinator = null
  }
}
