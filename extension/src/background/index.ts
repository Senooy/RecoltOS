/**
 * Script d'arrière-plan (service worker Chromium, page d'événements Firefox),
 * Tous les écouteurs sont posés au niveau supérieur, de façon synchrone ; l'alarme
 * `watchdog` est vérifiée à chaque démarrage (reconnexion du port, reprise de la sync).
 */
import type { BridgeCollection, SaveAck } from '../../../src/shared/bridge/save'
import type { PayloadOf } from '../../../src/shared/bridge/messages'
import type { SyncStateMessage } from '../../../src/shared/bridge/sync'
import { api, TARGET } from '../lib/api'
import { extLang, loadExtLang, rememberAppLang } from '../lib/i18n'
import { platformOfUrl, TEST_BASE } from '../lib/endpoints'
import type { PopupRequest, PopupState } from '../lib/popup-protocol'
import { getLocal, sessionGet, setLocal } from './creds'
import { parseMenuId, setupMenus } from './menus'
import { NativeBridge } from './native'
import { readPageMeta, showToast } from './page-functions'
import { maybeReload } from './reload-guard'
import { saveFromClick, type MenuInfo, type SaveDeps, type TabLike } from './save'
import { helloPayload, platformsState, SESSION_COOKIES } from './state'
import { ensureHeaderRules } from './sync/dnr'
import { backgroundFetch } from './sync/fetcher'
import { clientFor } from './sync/platforms'
import { SyncRunner } from './sync/runner'

const a = api()
const bridge = new NativeBridge({ hello: helloPayload })
const runner = new SyncRunner(bridge)

let collections: BridgeCollection[] = []
let stale: PopupState['stale'] = null
let syncState: SyncStateMessage['sources'] | null = null

// ---------------------------------------------------------------- enregistrement

async function exec<A extends unknown[], R>(
  tabId: number,
  fn: (...args: A) => R,
  args: A,
): Promise<Awaited<R>> {
  const [res] = await a.scripting.executeScript({
    target: { tabId },
    func: fn as (...x: unknown[]) => unknown,
    args,
  })
  return res?.result as Awaited<R>
}

function toast(
  tabId: number | undefined,
  text: string,
  kind: 'ok' | 'info' | 'error',
  action?: string,
) {
  const fallback = () => {
    if (kind === 'error') {
      void a.notifications
        .create({ type: 'basic', iconUrl: 'icons/128.png', title: 'RecoltOS', message: text })
        .catch(() => undefined)
    } else {
      void a.action.setBadgeText({ text: '✓' }).catch(() => undefined)
      setTimeout(() => void a.action.setBadgeText({ text: '' }).catch(() => undefined), 2_000)
    }
  }
  if (tabId === undefined) return fallback()
  exec(tabId, showToast, [text, kind, action ?? null]).catch(fallback)
}

const saveDeps: SaveDeps = {
  bridge,
  exec,
  captureTab: async (windowId) => {
    try {
      return await a.tabs.captureVisibleTab(windowId ?? a.windows.WINDOW_ID_CURRENT, {
        format: 'jpeg',
        quality: 92,
      })
    } catch {
      return null
    }
  },
  pageMeta: (tabId) => exec(tabId, readPageMeta, []).catch(() => null),
  toast,
  newId: () => globalThis.crypto.randomUUID(),
}

async function rememberCollection(id: string | null | undefined): Promise<void> {
  if (id) await setLocal('lastCollectionId', id)
}

async function onMenuClick(
  info: MenuInfo,
  tab: TabLike | undefined,
): Promise<SaveAck | { status: string } | null> {
  const parsed = parseMenuId(info.menuItemId)
  if (!parsed || !tab) return null
  if (parsed.more) {
    await a.storage.session.set({ pendingSave: { info, tab } })
    try {
      await a.action.openPopup()
    } catch {
      await a.windows.create({
        type: 'popup',
        url: a.runtime.getURL('popup.html?pending=1'),
        width: 380,
        height: 560,
      })
    }
    return null
  }
  await rememberCollection(parsed.collectionId)
  return saveFromClick(saveDeps, info, tab, { collectionId: parsed.collectionId })
}

// ---------------------------------------------------------------- popup

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [t] = await a.tabs.query({ active: true, lastFocusedWindow: true })
  return t
}

async function popupState(): Promise<PopupState> {
  const tab = await activeTab()
  let ogImage: string | null = null
  if (tab?.id !== undefined && /^https?:/.test(tab.url ?? '')) {
    ogImage = (await exec(tab.id, readPageMeta, []).catch(() => null))?.ogImage ?? null
  }
  const pending = await sessionGet<{ pendingSave: unknown }>('pendingSave')
  return {
    bridge: bridge.state,
    stale,
    target: TARGET,
    collections,
    lastCollectionId: (await getLocal<string>('lastCollectionId')) ?? null,
    tab: {
      id: tab?.id ?? null,
      url: tab?.url ?? null,
      title: tab?.title ?? null,
      platform: platformOfUrl(tab?.url),
    },
    ogImage,
    platforms: await platformsState().catch(() => null),
    sync: syncState,
    pending: !!pending.pendingSave,
    lang: extLang(),
  }
}

async function onPopup(msg: PopupRequest): Promise<unknown> {
  switch (msg.type) {
    case 'popup:state':
      return popupState()
    case 'popup:save': {
      await rememberCollection(msg.collectionId)
      const pending = await sessionGet<{ pendingSave: { info: MenuInfo; tab: TabLike } }>(
        'pendingSave',
      )
      if (pending.pendingSave) {
        await a.storage.session.remove('pendingSave')
        return saveFromClick(saveDeps, pending.pendingSave.info, pending.pendingSave.tab, {
          collectionId: msg.collectionId,
          ...(msg.note ? { note: msg.note } : {}),
        })
      }
      const tab = msg.tabId !== null ? await a.tabs.get(msg.tabId) : await activeTab()
      if (!tab) return { status: 'error', error: 'onglet introuvable' }
      const t: TabLike = { ...tab, ...(msg.title ? { title: msg.title } : {}) }
      if (msg.mode === 'image' && tab.id !== undefined) {
        const meta = await exec(tab.id, readPageMeta, []).catch(() => null)
        if (meta?.ogImage) {
          return saveFromClick(
            saveDeps,
            {
              menuItemId: 'rcl-save',
              mediaType: 'image',
              srcUrl: meta.ogImage,
              pageUrl: tab.url ?? '',
            },
            t,
            { collectionId: msg.collectionId, ...(msg.note ? { note: msg.note } : {}) },
          )
        }
      }
      return saveFromClick(saveDeps, { menuItemId: 'rcl-save', pageUrl: tab.url ?? '' }, t, {
        collectionId: msg.collectionId,
        ...(msg.note ? { note: msg.note } : {}),
      })
    }
    case 'popup:sync':
      try {
        bridge.post('sync.request', {
          trigger: 'manual',
          ...(msg.platform ? { platform: msg.platform } : {}),
        })
        return { ok: true }
      } catch {
        return { ok: false }
      }
    case 'popup:createCollection': {
      const m = await bridge.request('collection.create', { name: msg.name })
      const p = m.payload as PayloadOf<'collections.list.result'>
      collections = p.collections
      void setupMenus(collections)
      return p
    }
    case 'popup:statusChanged':
      void sendStatus()
      return { ok: true }
  }
}

// ---------------------------------------------------------------- état de session

let statusTimer: ReturnType<typeof setTimeout> | null = null
async function sendStatus(): Promise<void> {
  if (!bridge.connected) return
  try {
    bridge.post('ext.status', { platforms: await platformsState() })
  } catch {
    // port fermé
  }
}

// ---------------------------------------------------------------- écouteurs (niveau supérieur)

void a.alarms.get('watchdog').then((al) => {
  if (!al) void a.alarms.create('watchdog', { periodInMinutes: 1 })
})
a.runtime.onInstalled.addListener(() => {
  void loadExtLang().then(() => setupMenus(collections))
})
// Langue mémorisée (celle de l'app) avant les premiers menus et toasts.
void loadExtLang()
a.runtime.onStartup.addListener(() => bridge.ensure())
a.alarms.onAlarm.addListener((al) => {
  if (al.name === 'watchdog') {
    bridge.ensure()
    runner.watchdog()
  } else runner.onAlarm(al.name)
})
a.contextMenus.onClicked.addListener((info, tab) => {
  void onMenuClick(info, tab)
})
a.commands.onCommand.addListener((cmd, tab) => {
  if (cmd === 'save-page' && tab) {
    void saveFromClick(saveDeps, { menuItemId: 'rcl-save', pageUrl: tab.url ?? '' }, tab)
  }
})
a.cookies.onChanged.addListener((ch) => {
  if (!SESSION_COOKIES.has(ch.cookie.name)) return
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => void sendStatus(), 1_500)
})
a.runtime.onMessage.addListener((msg: unknown, sender, reply) => {
  if (sender.id !== a.runtime.id) return false
  const m = msg as { type?: string }
  if (typeof m?.type !== 'string') return false
  if (m.type.startsWith('popup:')) {
    onPopup(m as PopupRequest).then(reply, (err: unknown) =>
      reply({ status: 'error', error: err instanceof Error ? err.message : String(err) }),
    )
    return true
  }
  return runner.onContentMessage(m, sender, reply)
})

bridge.on('hello.ack', (m) => {
  const p = m.payload as PayloadOf<'hello.ack'>
  // Langue de l'app : popup, menus et toasts la suivent (menus reconstruits si elle change).
  if (p.lang && p.lang !== extLang()) {
    void rememberAppLang(p.lang).then(() => setupMenus(collections))
  }
  if (p.needsReload) {
    void maybeReload(p.bundledExtVersion, a.runtime.getManifest().version, (s) => {
      stale = s
      try {
        bridge.post('ext.stale', s)
      } catch {
        // port fermé
      }
    })
    return
  }
  runner.configure(p.settings)
})
const onCollections = (m: { payload?: unknown }) => {
  collections = (m.payload as PayloadOf<'collections.list.result'>).collections
  void setupMenus(collections)
}
bridge.on('collections.list.result', onCollections)
bridge.on('collections.changed', onCollections)
bridge.on('sync.state', (m) => {
  syncState = (m.payload as PayloadOf<'sync.state'>).sources
})
bridge.on('sync.run', (m) => void runner.run(m.payload as PayloadOf<'sync.run'>))
bridge.on('sync.cancel', (m) => runner.cancel((m.payload as PayloadOf<'sync.cancel'>).runId))
bridge.on('item.refresh', (m) => void runner.refreshItem(m.payload as PayloadOf<'item.refresh'>))
bridge.on('media.fetch', (m) => void runner.proxyMedia(m.payload as PayloadOf<'media.fetch'>))
bridge.on('authors.wanted', (m) =>
  runner.setWantedAuthors(m.payload as PayloadOf<'authors.wanted'>),
)
bridge.onState((s) => {
  if (s === 'app_connected') runner.watchdog()
})
bridge.connect()

declare const __RECOLTOS_SELFTEST__: boolean

/**
 * Build de test `--selftest` seulement (navigateur jetable, faux serveur) : pose des cookies factices
 * pour le faux serveur, fait une requête X depuis l'arrière-plan et rapporte le résultat.
 */
async function selfTest(base: string): Promise<void> {
  const report: Record<string, unknown> = { target: TARGET }
  try {
    report.permission = await a.permissions.contains({ origins: [`${base}/*`] })
    // Cookies posés par le faux serveur (comme une connexion au site), puis relus par l'API `cookies`.
    report.plain = await fetch(`${base}/img.png`).then(
      (r) => r.status,
      (e: unknown) => String(e),
    )
    await fetch(`${base}/setcookies`, { credentials: 'include' })
    report.cookies = (await a.cookies.getAll({ url: `${base}/` })).map((c) => c.name)
    await ensureHeaderRules()
    const page = await clientFor('x').fetchPage(null, backgroundFetch)
    report.page = page.kind === 'page' ? { kind: 'page', status: page.status } : page
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e)
  }
  console.warn(`[recoltos selftest] ${JSON.stringify(report)}`)
  await fetch(`${base}/selftest`, { method: 'POST', body: JSON.stringify(report) }).catch(
    (e: unknown) => console.warn(`[recoltos selftest] rapport impossible : ${String(e)}`),
  )
}

// Build de test seulement : poignées pour Playwright (jamais dans le build livré).
if (TEST_BASE) {
  if (typeof __RECOLTOS_SELFTEST__ === 'boolean' && __RECOLTOS_SELFTEST__) {
    const base = TEST_BASE
    setTimeout(() => void selfTest(base), 1_500)
  }
  ;(globalThis as Record<string, unknown>).__recoltos = {
    bridge,
    runner,
    saveImage: (srcUrl: string, pageUrl: string, tabId?: number) =>
      saveFromClick(
        saveDeps,
        { menuItemId: 'rcl-save', mediaType: 'image', srcUrl, pageUrl },
        { url: pageUrl, title: 'Page de test', ...(tabId !== undefined ? { id: tabId } : {}) },
      ),
    menuClick: onMenuClick,
    state: () => popupState(),
    fetchPage: async (p: 'x' | 'instagram' | 'cosmos', cursor: string | null) => {
      await ensureHeaderRules()
      return clientFor(p).fetchPage(cursor, backgroundFetch)
    },
  }
}
