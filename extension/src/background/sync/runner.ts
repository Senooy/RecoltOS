/**
 * Exécuteur de synchronisation (WP-54, ERRATA §G.2) : exécute les `sync.run` de l'app DEPUIS
 * L'ARRIÈRE-PLAN, sans onglet. Une page à la fois : requête → `sync.page` → `sync.ack` de l'app
 * (continuer avec le curseur, ou s'arrêter : élément connu, plafond, budget) → délai → page suivante.
 * Erreurs classées (`auth_required`, `blocked`, `rate_limited`, `api_changed`, `network`,
 * `permissions`) remontées par `sync.finished`. Alarme `sync-tick` (5 min) : `sync.request
 * {trigger:'schedule'}` pour que l'app décide de ce qui est dû. Les gabarits, jetons et indices
 * venus des scripts de contenu arrivent par `onContentMessage`.
 */
import { CHUNK_BYTES, type BridgePlatform } from '../../../../src/shared/bridge/constants'
import type { HelloAck, PayloadOf } from '../../../../src/shared/bridge/messages'
import type { SyncAckMessage, SyncOutcome, SyncTarget } from '../../../../src/shared/bridge/sync'
import { api } from '../../lib/api'
import { ENDPOINTS, platformOfUrl } from '../../lib/endpoints'
import { sessionGet, setLocal } from '../creds'
import type { NativeBridge } from '../native'
import { hasPermission, platformState } from '../state'
import { ensureHeaderRules } from './dnr'
import { backgroundFetch, jitter, sleep, tabFetch, type FetchFn } from './fetcher'
import { clientFor, InstagramClient, XClient, type PageOutcome } from './platforms'
import { targetsFor, type ExecTarget } from './policy'

export const SYNC_TICK = 'sync-tick'
const RUNS_KEY = 'sync.runs'

interface ActiveRun {
  runId: string
  cancelled: boolean
}

export interface RunnerDeps {
  fetchFor?: (
    t: ExecTarget,
    p: BridgePlatform,
  ) => Promise<{ fetch: FetchFn; close?: () => Promise<void> } | null>
  sleep?: (ms: number) => Promise<void>
  /** Délai minimum entre deux pages si l'app n'en impose pas (X : 2 à 4 s). */
  defaultDelay?: () => number
}

type Bridge = Pick<NativeBridge, 'post' | 'request' | 'connected'>

export class SyncRunner {
  readonly bridge: Bridge
  private readonly deps: RunnerDeps
  settings: HelloAck['settings'] | null = null
  private active = new Map<BridgePlatform, ActiveRun>()
  wanted: PayloadOf<'authors.wanted'>['authors'] = []

  constructor(bridge: Bridge, deps: RunnerDeps = {}) {
    this.bridge = bridge
    this.deps = deps
  }

  configure(s: HelloAck['settings']): void {
    this.settings = s
    this.setWantedAuthors({ authors: s.wantedAuthors })
  }

  setWantedAuthors(p: PayloadOf<'authors.wanted'>): void {
    this.wanted = p.authors
  }

  isRunning(p: BridgePlatform): boolean {
    return this.active.has(p)
  }

  run(r: PayloadOf<'sync.run'>): Promise<SyncOutcome> {
    if (this.active.has(r.platform)) {
      this.safePost('sync.finished', { runId: r.runId, status: 'aborted', error: 'déjà en cours' })
      return Promise.resolve('aborted')
    }
    const run: ActiveRun = { runId: r.runId, cancelled: false }
    this.active.set(r.platform, run)
    return this.loop(r, run).finally(() => {
      this.active.delete(r.platform)
      void this.forget(r.runId)
    })
  }

  cancel(runId: string): void {
    for (const run of this.active.values()) if (run.runId === runId) run.cancelled = true
  }

  private safePost<T extends Parameters<Bridge['post']>[0]>(type: T, payload: PayloadOf<T>): void {
    try {
      this.bridge.post(type, payload)
    } catch {
      // port fermé : l'app reprendra au prochain créneau
    }
  }

  private async remember(runId: string, platform: BridgePlatform, pages: number): Promise<void> {
    try {
      const s = api().storage.session
      const got = await sessionGet<{ [RUNS_KEY]: Record<string, unknown> }>(RUNS_KEY)
      await s.set({ [RUNS_KEY]: { ...(got[RUNS_KEY] ?? {}), [runId]: { platform, pages } } })
    } catch {
      // stockage de session indisponible
    }
  }

  private async forget(runId: string): Promise<void> {
    try {
      const s = api().storage.session
      const got = await sessionGet<{ [RUNS_KEY]: Record<string, unknown> }>(RUNS_KEY)
      const runs = { ...(got[RUNS_KEY] ?? {}) }
      delete runs[runId]
      await s.set({ [RUNS_KEY]: runs })
    } catch {
      // idem
    }
  }

  /** Requête d'arrière-plan ou repli (onglet existant / créé). */
  private async fetchFor(
    t: ExecTarget,
    p: BridgePlatform,
  ): Promise<{ fetch: FetchFn; close?: () => Promise<void> } | null> {
    if (this.deps.fetchFor) return this.deps.fetchFor(t, p)
    if (t.kind === 'background') return { fetch: backgroundFetch }
    if (t.kind === 'tab') return { fetch: tabFetch(t.tabId) }
    const a = api()
    const tab = await a.tabs.create({
      url: ENDPOINTS[p].tabPatterns[0]!.replace('/*', '/'),
      active: false,
    })
    if (tab.id === undefined) return null
    await a.tabs.update(tab.id, { autoDiscardable: false }).catch(() => undefined)
    await this.trackTab(tab.id)
    const id = tab.id
    for (let i = 0; i < 40; i++) {
      const t2 = await a.tabs.get(id).catch(() => null)
      if (t2?.status === 'complete') break
      await sleep(500)
    }
    return {
      fetch: tabFetch(id),
      close: async () => {
        await a.tabs.remove(id).catch(() => undefined)
        await this.untrackTab(id)
      },
    }
  }

  private async existingTab(p: BridgePlatform): Promise<number | null> {
    try {
      const tabs = await api().tabs.query({ url: ENDPOINTS[p].tabPatterns, status: 'complete' })
      return tabs.find((t) => !t.discarded && t.id !== undefined)?.id ?? null
    } catch {
      return null
    }
  }

  private async loop(r: PayloadOf<'sync.run'>, run: ActiveRun): Promise<SyncOutcome> {
    const p = r.platform
    let pages = 0
    let target: SyncTarget = 'background'
    const finish = (status: SyncOutcome, error?: string, resetAt?: number): SyncOutcome => {
      this.safePost('sync.finished', {
        runId: r.runId,
        status,
        pages,
        target,
        ...(error ? { error: error.slice(0, 500) } : {}),
        ...(resetAt ? { resetAt } : {}),
      })
      return status
    }
    if (!(await hasPermission(p))) return finish('permissions', 'autorisations d’hôte manquantes')
    // Cosmos : la session se vérifie par `me` (jeton capturé ou cookies), pas par un cookie connu.
    if (p !== 'cosmos' && !(await platformState(p)).loggedIn) {
      return finish('auth_required', 'aucune session dans ce navigateur')
    }
    await ensureHeaderRules()
    const client = clientFor(p)
    const targets = targetsFor({
      trigger: r.trigger,
      existingTabId: await this.existingTab(p),
      allowBackgroundTab: r.allowBackgroundTab ?? this.settings?.allowBackgroundTab[p] ?? false,
    })
    let ti = 0
    let exec = await this.fetchFor(targets[0]!, p)
    const closeAll: (() => Promise<void>)[] = []
    if (exec?.close) closeAll.push(exec.close)
    let cursor = r.startCursor ?? null
    try {
      while (pages < r.maxPages) {
        if (run.cancelled) return finish('aborted')
        if (!exec) return finish('network', 'aucune cible d’exécution')
        let page: PageOutcome = await this.withRetries(() => client.fetchPage(cursor, exec!.fetch))
        // Repli seulement si l'arrière-plan est refusé.
        while (page.kind === 'error' && page.outcome === 'blocked' && ti < targets.length - 1) {
          ti += 1
          const t = targets[ti]!
          exec = await this.fetchFor(t, p)
          if (!exec) break
          if (exec.close) closeAll.push(exec.close)
          target = t.kind
          page = await this.withRetries(() => client.fetchPage(cursor, exec!.fetch))
        }
        if (page.kind === 'error') return finish(page.outcome, page.error, page.resetAt)
        await this.remember(r.runId, p, pages + 1)
        const ackMsg = await this.bridge.request(
          'sync.page',
          {
            runId: r.runId,
            platform: p,
            pageIndex: pages,
            origin: 'replay',
            status: page.status,
            headers: page.headers,
            json: page.json,
            target,
          },
          120_000,
        )
        pages += 1
        const ack = ackMsg.payload as SyncAckMessage
        if (ack.decision === 'stop' || !ack.nextCursor) return finish(ack.outcome ?? 'ok')
        cursor = ack.nextCursor
        await (this.deps.sleep ?? sleep)(
          ack.delayMs ?? this.deps.defaultDelay?.() ?? jitter(2_000, 4_000),
        )
      }
      return finish('ok')
    } catch (e) {
      return finish('network', e instanceof Error ? e.message : String(e))
    } finally {
      for (const c of closeAll) await c()
    }
  }

  /** Erreurs réseau : 3 nouvelles tentatives (2, 4, 8 s). */
  private async withRetries(fn: () => Promise<PageOutcome>): Promise<PageOutcome> {
    let res = await fn()
    for (const wait of [2_000, 4_000, 8_000]) {
      if (res.kind !== 'error' || res.outcome !== 'network') return res
      await (this.deps.sleep ?? sleep)(wait)
      res = await fn()
    }
    return res
  }

  // ------------------------------------------------------------------ onglets créés (repli)

  private async trackTab(id: number): Promise<void> {
    const got = await sessionGet<{ 'sync.tabs': number[] }>('sync.tabs')
    await api().storage.session.set({ 'sync.tabs': [...(got['sync.tabs'] ?? []), id] })
  }

  private async untrackTab(id: number): Promise<void> {
    const got = await sessionGet<{ 'sync.tabs': number[] }>('sync.tabs')
    await api().storage.session.set({
      'sync.tabs': (got['sync.tabs'] ?? []).filter((t) => t !== id),
    })
  }

  /**
   * Alarme `watchdog` / redémarrage du script d'arrière-plan : runs interrompus signalés `aborted`
   * (l'app reprogramme), onglets de repli orphelins fermés, alarme `sync-tick` vérifiée.
   */
  watchdog(): void {
    void (async () => {
      const a = api()
      const al = await a.alarms.get(SYNC_TICK).catch(() => undefined)
      if (!al) void a.alarms.create(SYNC_TICK, { periodInMinutes: 5 })
      const got = await sessionGet<{
        [RUNS_KEY]: Record<string, { platform: BridgePlatform; pages: number }>
        'sync.tabs': number[]
      }>([RUNS_KEY, 'sync.tabs'])
      for (const [runId, r] of Object.entries(got[RUNS_KEY] ?? {})) {
        if ([...this.active.values()].some((x) => x.runId === runId)) continue
        this.safePost('sync.finished', { runId, status: 'aborted', pages: r.pages })
        await this.forget(runId)
      }
      if (this.active.size === 0) {
        for (const id of got['sync.tabs'] ?? []) await a.tabs.remove(id).catch(() => undefined)
        await a.storage.session.set({ 'sync.tabs': [] })
      }
    })().catch(() => undefined)
  }

  onAlarm(name: string): void {
    if (name === SYNC_TICK && this.bridge.connected) {
      this.safePost('sync.request', { trigger: 'schedule' })
    }
  }

  // ------------------------------------------------------------------ demandes ponctuelles

  /** `item.refresh` (Instagram, dans le budget de l'app) : `media/<pk>/info/` → `item.data`. */
  async refreshItem(p: PayloadOf<'item.refresh'>): Promise<void> {
    if (p.platform !== 'instagram') return
    await ensureHeaderRules()
    const res = await new InstagramClient().fetchMediaInfo(p.externalId, backgroundFetch)
    this.safePost('item.data', {
      platform: p.platform,
      externalId: p.externalId,
      status: res.kind === 'page' ? res.status : 0,
      json: res.kind === 'page' ? res.json : { error: res.outcome },
    })
  }

  /** `media.fetch` (secours 403) : téléchargé ici, renvoyé en `media.chunk` de 8 Mio. */
  async proxyMedia(p: PayloadOf<'media.fetch'>): Promise<void> {
    const fail = (error: string) =>
      this.safePost('media.chunk', { jobId: p.jobId, seq: 0, last: true, data: '', error })
    try {
      const r = await fetch(p.url, { credentials: 'omit', referrer: p.referer ?? '' })
      if (!r.ok) return fail(`réponse ${r.status}`)
      const buf = new Uint8Array(await r.arrayBuffer())
      const mime = r.headers.get('content-type') ?? 'application/octet-stream'
      let seq = 0
      for (let off = 0; off < Math.max(buf.length, 1); off += CHUNK_BYTES) {
        const part = buf.subarray(off, off + CHUNK_BYTES)
        let bin = ''
        for (let i = 0; i < part.length; i += 0x8000) {
          bin += String.fromCharCode(...part.subarray(i, i + 0x8000))
        }
        this.safePost('media.chunk', {
          jobId: p.jobId,
          seq,
          last: off + CHUNK_BYTES >= buf.length,
          mime,
          data: btoa(bin),
        })
        seq += 1
      }
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
    }
  }

  // ------------------------------------------------------------------ scripts de contenu

  /** Messages du pont de contenu (onglets x.com / instagram.com / cosmos.so). */
  onContentMessage(
    m: unknown,
    sender: chrome.runtime.MessageSender,
    reply: (r: unknown) => void,
  ): boolean {
    const msg = m as { type?: string; payload?: Record<string, unknown> }
    const platform = platformOfUrl(sender.tab?.url)
    if (!platform || !msg.type?.startsWith('content:')) return false
    const p = msg.payload ?? {}
    switch (msg.type) {
      case 'content:x-template':
        if (platform === 'x') {
          void XClient.storeTemplate(p)
          if (typeof p.tid === 'string' && p.tid.length < 200) void setLocal('x.tid', p.tid)
        }
        break
      case 'content:ig-claim':
        if (platform === 'instagram') {
          if (typeof p.claim === 'string' && p.claim.length < 500)
            void setLocal('ig.claim', p.claim)
          if (typeof p.asbd === 'string' && /^\d{1,10}$/.test(p.asbd))
            void setLocal('ig.asbd', p.asbd)
        }
        break
      case 'content:cosmos-token':
        if (platform === 'cosmos' && typeof p.token === 'string' && p.token.length < 4096) {
          void setLocal('cosmos.token', p.token)
          if (typeof p.query === 'string')
            void setLocal('cosmos.template', { query: p.query, order: p.order })
        }
        break
      case 'content:hint':
        if (this.settings?.sync[platform]) {
          this.safePost('sync.hint', {
            platform,
            reason: 'native_save',
            ...(sender.tab?.id !== undefined ? { tabId: sender.tab.id } : {}),
          })
        }
        break
      case 'content:capture':
        if (this.settings?.sync[platform] && typeof p.op === 'string') {
          this.safePost('capture.passive', {
            platform,
            op: p.op.slice(0, 64),
            status: typeof p.status === 'number' ? p.status : 200,
            json: p.json,
            ...(sender.tab?.url ? { tabUrl: sender.tab.url } : {}),
          })
        }
        break
      case 'content:save-post':
        void this.bridge
          .request('save.create', p as unknown as PayloadOf<'save.create'>, 120_000)
          .then((r) => reply(r.payload))
          .catch((e: unknown) =>
            reply({ status: 'error', error: e instanceof Error ? e.message : String(e) }),
          )
        return true
      default:
        return false
    }
    reply({ ok: true })
    return false
  }
}
