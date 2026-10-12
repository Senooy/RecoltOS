/**
 * `SyncCoordinator` : l'app décide QUAND et QUOI synchroniser,
 * l'extension exécute en arrière-plan (sans onglet). Planning X 15 min, Instagram 30, Cosmos 30 ;
 * modes `incremental` / `backfill` (tranches reprises par curseur) / `deep` (hebdomadaire) /
 * `passive` (captures) ; un client par plateforme (session active, plus récemment vu) ; budgets et
 * cooldowns ; 3 échecs d'affilée → intervalle doublé (≤ 6 h) ; `auth_required` → aucune relance
 * automatique tant que la session ne change pas ; publication de `evt:sync.status`.
 */
import type { BridgePlatform } from '../../shared/bridge/constants'
import { BRIDGE_PLATFORMS } from '../../shared/bridge/constants'
import type { HelloAck, PayloadOf } from '../../shared/bridge/messages'
import type { SaveRequest } from '../../shared/bridge/save'
import type { SyncMode, SyncOutcome } from '../../shared/bridge/sync'
import type { SyncDetail, SyncRunInfo, SyncSourceStatus, SyncStatus } from '../../shared/dto/sync'
import type { Prefs } from '../../shared/prefs'
import type { SyncStateRow } from '../db/repos/sync'
import { emitItemsChanged } from '../events'
import type { IngestResult } from '../ingest/ingest'
import type { LibraryContext } from '../library/library-context'
import { authorSeen, wantedAuthors } from './authors'
import { PlatformBudget, type BudgetState } from './budget'
import { IMPORTED_FLAGS_KEY } from './import-prefill'
import { ingestPage, downloadPriority } from './ingest'
import { startOrder, type OrderCursor, type RunMode } from './order'
import {
  parseInstagramMediaInfo,
  parseSyncPage,
  type NormalizedPost,
  type PageParseResult,
} from './parsers'
import { mt } from '../i18n'

export const INTERVAL_MIN: Readonly<Record<BridgePlatform, number>> = {
  x: 15,
  instagram: 30,
  cosmos: 30,
}
export const MAX_PAGES: Readonly<Record<SyncMode, Record<BridgePlatform, number>>> = {
  incremental: { x: 10, instagram: 5, cosmos: 5 },
  backfill: { x: 50, instagram: 20, cosmos: 25 },
  deep: { x: 10, instagram: 10, cosmos: 10 },
}
/** Délai entre deux tranches de backfill (réussies). */
export const BACKFILL_GAP_MIN: Readonly<Record<BridgePlatform, number>> = {
  x: 2,
  instagram: 30,
  cosmos: 2,
}
export const DEEP_EVERY_MS = 7 * 24 * 3_600_000
export const MAX_BACKOFF_MS = 6 * 3_600_000
export const HINT_DEBOUNCE_MS = 3_000
export const RUN_STALE_MS = 15 * 60_000

export type RunReason = 'schedule' | 'manual' | 'hint' | 'toggle' | 'import'

export interface ClientView {
  connId: number
  label: string
  loggedIn: Partial<Record<BridgePlatform, boolean>>
  permission: Partial<Record<BridgePlatform, boolean | null>>
  lastSeenAt: number
}

/** Ce dont le coordinateur a besoin du pont (testable sans socket). */
export interface BridgePort {
  clients(): ClientView[]
  send<T extends 'sync.run' | 'sync.ack' | 'item.refresh' | 'sync.state' | 'authors.wanted'>(
    connId: number,
    type: T,
    payload: PayloadOf<T>,
    re?: string,
  ): boolean
  broadcast(type: 'sync.state', payload: PayloadOf<'sync.state'>): void
}

export interface CoordinatorDeps {
  lib(): LibraryContext | null
  bridge(): BridgePort | null
  prefs(): Prefs
  now(): number
  emitStatus(s: SyncStatus): void
  kickJobs(): void
  /** Rendu des cartes des posts texte (file sérielle). */
  renderCards(itemIds: number[]): void
  /** Avertissement GatherOS (calculé à part, mis en cache). */
  gatherosConflict(): boolean
  clientsDto(): SyncStatus['clients']
  log: { info(...a: unknown[]): void; warn(...a: unknown[]): void }
  newId(): string
}

interface RunCtx {
  runId: string
  platform: BridgePlatform
  mode: SyncMode
  reason: RunReason
  connId: number
  browser: string
  startedAt: number
  lastActivity: number
  order: OrderCursor
  pages: number
  newItems: number
  known: number
  requestCursor: string | null
  finished: boolean
}

const OK_STATES = new Set(['ok', 'idle', 'running'])

export class SyncCoordinator {
  private readonly d: CoordinatorDeps
  private runs = new Map<string, RunCtx>()
  private budgets = new Map<string, PlatformBudget>()
  private hintTimers = new Map<BridgePlatform, ReturnType<typeof setTimeout>>()
  private refreshed = new Map<string, number>()
  private passiveOrder = new Map<BridgePlatform, OrderCursor>()
  private lastStatusJson = ''

  constructor(deps: CoordinatorDeps) {
    this.d = deps
  }

  // ------------------------------------------------------------------ état

  private state(lib: LibraryContext, p: BridgePlatform): SyncStateRow {
    return lib.repos.sync.getState(p)
  }

  private runningFor(p: BridgePlatform): RunCtx | null {
    for (const r of this.runs.values()) if (r.platform === p && !r.finished) return r
    return null
  }

  private budget(lib: LibraryContext, p: BridgePlatform): PlatformBudget {
    const key = `${lib.root}:${p}`
    let b = this.budgets.get(key)
    if (!b) {
      const st = this.state(lib, p)
      const counts = (lib.repos.settings.get('sync.cooldowns') ?? {}) as Partial<
        Record<BridgePlatform, number>
      >
      const initial: BudgetState = {
        budgetDay: st.budget_day,
        budgetUsed: st.budget_used,
        cooldownUntil: st.cooldown_until,
        cooldowns: counts[p] ?? 0,
      }
      b = new PlatformBudget(p, initial, (s) => {
        const l = this.d.lib()
        if (!l) return
        l.repos.sync.patchState(p, {
          budgetDay: s.budgetDay,
          budgetUsed: s.budgetUsed,
          cooldownUntil: s.cooldownUntil,
        })
        const all = (l.repos.settings.get('sync.cooldowns') ?? {}) as Record<string, number>
        l.repos.settings.set('sync.cooldowns', { ...all, [p]: s.cooldowns })
      })
      this.budgets.set(key, b)
    }
    return b
  }

  /** Client choisi pour une plateforme : session active, sinon aucun. */
  pickClient(p: BridgePlatform): ClientView | null {
    const list = this.d.bridge()?.clients() ?? []
    return list.filter((c) => c.loggedIn[p]).sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0] ?? null
  }

  private detailFor(p: BridgePlatform, st: SyncStateRow): SyncDetail | null {
    const clients = this.d.bridge()?.clients() ?? []
    if (st.last_error && ['blocked', 'permissions', 'network', 'budget'].includes(st.last_error)) {
      if (st.status !== 'ok' && st.status !== 'idle') return st.last_error as SyncDetail
    }
    if (clients.length === 0) return 'browser_closed'
    if (clients.every((c) => c.permission[p] === false)) return 'permissions'
    if (!clients.some((c) => c.loggedIn[p])) return 'not_logged_in'
    return null
  }

  private intervalMs(p: BridgePlatform, st: SyncStateRow): number {
    const base = INTERVAL_MIN[p] * 60_000
    const f = st.consecutive_failures >= 3 ? 2 ** (st.consecutive_failures - 2) : 1
    return Math.min(base * f, MAX_BACKOFF_MS)
  }

  private nextRunAt(p: BridgePlatform, st: SyncStateRow): number | null {
    if (!st.enabled) return null
    const last = st.last_run_at ?? 0
    const gap =
      !st.backfill_done && st.status === 'ok'
        ? BACKFILL_GAP_MIN[p] * 60_000
        : this.intervalMs(p, st)
    return Math.max(last + gap, st.cooldown_until ?? 0)
  }

  status(): SyncStatus {
    const lib = this.d.lib()
    const clients = this.d.bridge()?.clients() ?? []
    const imported = lib
      ? ((lib.repos.settings.get(IMPORTED_FLAGS_KEY) ?? {}) as Partial<
          Record<BridgePlatform, boolean | null>
        >)
      : {}
    const sources: SyncSourceStatus[] = BRIDGE_PLATFORMS.map((p) => {
      const st = lib
        ? this.state(lib, p)
        : ({ source: p, enabled: 0, allow_background_tab: 0, status: 'idle' } as SyncStateRow)
      const run = this.runningFor(p)
      const chosen = this.pickClient(p)
      const recovered = lib
        ? (
            lib.db
              .prepare(
                `SELECT count(*) AS n FROM sync_items s JOIN items i ON i.id = s.item_id
                 WHERE s.source = ? AND s.recovered_at IS NOT NULL AND i.deleted_at IS NULL`,
              )
              .get(p) as { n: number }
          ).n
        : 0
      return {
        source: p,
        enabled: !!st.enabled,
        allowBackgroundTab: !!st.allow_background_tab,
        accountHandle: st.account_handle ?? null,
        status: run ? 'running' : ((st.status ?? 'idle') as SyncSourceStatus['status']),
        detail: lib ? this.detailFor(p, st) : null,
        lastRunAt: st.last_run_at ?? null,
        lastSuccessAt: st.last_success_at ?? null,
        lastNewCount: st.last_new_count ?? 0,
        lastError: st.last_error ?? null,
        totalSynced: st.total_synced ?? 0,
        backfillDone: !!st.backfill_done,
        cooldownUntil: st.cooldown_until ?? null,
        running: run ? { mode: run.mode, pages: run.pages, newItems: run.newItems } : null,
        browser: chosen?.label ?? null,
        loggedIn: clients.length ? clients.some((c) => c.loggedIn[p]) : null,
        recovered,
        importedFlag: imported[p] ?? null,
        nextRunAt: lib ? this.nextRunAt(p, st) : null,
      }
    })
    return {
      sources,
      clients: this.d.clientsDto(),
      gatherosConflict: this.d.gatherosConflict(),
      browserConnected: clients.length > 0,
      bridgeRunning: this.d.bridge() !== null,
    }
  }

  /** Publie l'état (renderer + popup de l'extension) s'il a changé. */
  publish(): void {
    const s = this.status()
    const json = JSON.stringify(s)
    if (json === this.lastStatusJson) return
    this.lastStatusJson = json
    this.d.emitStatus(s)
    const sources = Object.fromEntries(
      s.sources.map((x) => [
        x.source,
        { enabled: x.enabled, status: x.status, lastSuccessAt: x.lastSuccessAt, detail: x.detail },
      ]),
    ) as PayloadOf<'sync.state'>['sources']
    this.d.bridge()?.broadcast('sync.state', { sources })
  }

  helloSettings(): HelloAck['settings'] {
    const lib = this.d.lib()
    const flag = (f: (st: SyncStateRow) => boolean) =>
      Object.fromEntries(
        BRIDGE_PLATFORMS.map((p) => [p, lib ? f(this.state(lib, p)) : false]),
      ) as Record<BridgePlatform, boolean>
    return {
      sync: flag((st) => !!st.enabled),
      allowBackgroundTab: flag((st) => !!st.allow_background_tab),
      intervalsMin: { ...INTERVAL_MIN },
      maxPages: { ...MAX_PAGES.incremental },
      wantedAuthors: lib ? wantedAuthors(lib) : [],
    }
  }

  // ------------------------------------------------------------------ actions (IPC)

  setEnabled(p: BridgePlatform, on: boolean): void {
    const lib = this.d.lib()
    if (!lib) return
    lib.repos.sync.patchState(p, {
      enabled: on,
      ...(on ? { status: 'idle', lastError: null } : {}),
    })
    if (!on) {
      const r = this.runningFor(p)
      if (r) this.finish(r, 'aborted', 'désactivé')
    } else {
      void this.start(p, this.state(lib, p).backfill_done ? 'incremental' : 'backfill', 'toggle')
    }
    this.publish()
  }

  setAllowBackgroundTab(p: BridgePlatform, on: boolean): void {
    this.d.lib()?.repos.sync.patchState(p, { allowBackgroundTab: on })
    this.publish()
  }

  /** « Synchroniser maintenant » : incrémental immédiat (cooldown respecté). */
  runNow(p?: BridgePlatform): void {
    const lib = this.d.lib()
    if (!lib) return
    for (const q of p ? [p] : BRIDGE_PLATFORMS) {
      const st = this.state(lib, q)
      if (!st.enabled) continue
      // Une action de l'utilisateur relève l'interdiction de relance (session refusée…).
      if (st.status === 'auth_required')
        lib.repos.sync.patchState(q, { status: 'idle', lastError: null })
      void this.start(q, st.backfill_done ? 'incremental' : 'backfill', 'manual')
    }
    this.publish()
  }

  resyncAll(p: BridgePlatform): void {
    const lib = this.d.lib()
    if (!lib) return
    lib.repos.sync.patchState(p, {
      backfillDone: false,
      backfillCursor: null,
      backfillAnchorAt: null,
      backfillPos: 0,
    })
    if (this.state(lib, p).enabled) void this.start(p, 'backfill', 'manual')
    this.publish()
  }

  runHistory(p: BridgePlatform, limit: number): SyncRunInfo[] {
    const lib = this.d.lib()
    if (!lib) return []
    return lib.repos.sync.listRuns(p, limit).map((r) => ({
      id: String(r.id),
      source: p,
      mode: String(r.mode),
      reason: String(r.reason),
      browser: (r.browser as string | null) ?? null,
      target: (r.target as string | null) ?? null,
      startedAt: Number(r.started_at),
      finishedAt: (r.finished_at as number | null) ?? null,
      pages: Number(r.pages),
      newItems: Number(r.new_items),
      knownItems: Number(r.known_items),
      status: (r.status as string | null) ?? null,
      error: (r.error as string | null) ?? null,
    }))
  }

  // ------------------------------------------------------------------ planning

  /**
   * Démarre un run si les conditions le permettent ; rend l'identifiant ou `null` (état mis à jour :
   * `no_browser`, `auth_required`, `rate_limited`…). Jamais deux runs pour une même plateforme.
   */
  start(p: BridgePlatform, mode: SyncMode, reason: RunReason, maxPages?: number): string | null {
    const lib = this.d.lib()
    const bridge = this.d.bridge()
    if (!lib || !bridge) return null
    const st = this.state(lib, p)
    if (!st.enabled || this.runningFor(p)) return null
    const now = this.d.now()
    const clients = bridge.clients()
    if (clients.length === 0) {
      lib.repos.sync.patchState(p, { status: 'no_browser' })
      return null
    }
    const client = this.pickClient(p)
    if (!client) {
      lib.repos.sync.patchState(p, {
        status: 'auth_required',
        lastError: clients.every((c) => c.permission[p] === false) ? 'permissions' : null,
      })
      return null
    }
    const b = this.budget(lib, p)
    const ok = b.check('page', now)
    if (!ok.ok && ok.reason !== 'run') {
      lib.repos.sync.patchState(p, {
        status: 'rate_limited',
        lastError: ok.reason === 'day' ? 'budget' : null,
        cooldownUntil: ok.until ?? st.cooldown_until,
      })
      return null
    }
    b.startRun()
    const runId = this.d.newId()
    const order = startOrder(mode, st, now)
    const ctx: RunCtx = {
      runId,
      platform: p,
      mode,
      reason,
      connId: client.connId,
      browser: client.label,
      startedAt: now,
      lastActivity: now,
      order,
      pages: 0,
      newItems: 0,
      known: 0,
      requestCursor: mode === 'backfill' ? st.backfill_cursor : null,
      finished: false,
    }
    this.runs.set(runId, ctx)
    lib.repos.sync.startRun({
      id: runId,
      source: p,
      mode,
      reason,
      browser: client.label,
      startedAt: now,
    })
    lib.repos.sync.patchState(p, { status: 'running', lastRunAt: now })
    const sent = bridge.send(client.connId, 'sync.run', {
      runId,
      platform: p,
      mode,
      trigger: reason,
      startCursor: ctx.requestCursor,
      maxPages: maxPages ?? MAX_PAGES[mode][p],
      allowBackgroundTab: !!st.allow_background_tab,
    })
    if (!sent) this.finish(ctx, 'network', 'extension injoignable')
    this.publish()
    return runId
  }

  /** Évalue le planning (minuterie, `sync.request {schedule}`, changement de clients). */
  tick(): void {
    const lib = this.d.lib()
    if (!lib || !this.d.bridge()) return
    const now = this.d.now()
    for (const r of this.runs.values()) {
      if (!r.finished && now - r.lastActivity > RUN_STALE_MS)
        this.finish(r, 'aborted', 'sans nouvelles')
    }
    for (const p of BRIDGE_PLATFORMS) {
      const st = this.state(lib, p)
      if (!st.enabled || this.runningFor(p)) continue
      if (st.status === 'auth_required' && !this.pickClient(p)) continue
      if (st.status === 'auth_required' && st.last_error === 'blocked') continue
      const next = this.nextRunAt(p, st)
      if (next !== null && next > now) continue
      const mode: SyncMode = !st.backfill_done
        ? 'backfill'
        : (st.last_deep_at ?? 0) + DEEP_EVERY_MS < now && st.last_success_at
          ? 'deep'
          : 'incremental'
      this.start(p, mode, 'schedule')
    }
    this.publish()
  }

  /** Changement de clients ou de sessions : lève `auth_required` si la session est revenue. */
  onClientsChanged(): void {
    const lib = this.d.lib()
    if (lib) {
      for (const p of BRIDGE_PLATFORMS) {
        const st = this.state(lib, p)
        if (st.status === 'no_browser' && this.d.bridge()?.clients().length) {
          lib.repos.sync.patchState(p, { status: 'idle' })
        }
        if (st.status === 'auth_required' && st.last_error !== 'blocked' && this.pickClient(p)) {
          lib.repos.sync.patchState(p, { status: 'idle', lastError: null })
        }
      }
    }
    this.tick()
  }

  /** Favori natif détecté : une page, 3 s plus tard, si la source est active. */
  hint(p: BridgePlatform): void {
    const old = this.hintTimers.get(p)
    if (old) clearTimeout(old)
    const t = setTimeout(() => {
      this.hintTimers.delete(p)
      this.start(p, 'incremental', 'hint', 1)
    }, HINT_DEBOUNCE_MS)
    t.unref?.()
    this.hintTimers.set(p, t)
  }

  // ------------------------------------------------------------------ pages

  /** Analyse + ingestion d'une page ; rend la décision pour l'extension. */
  onPage(m: PayloadOf<'sync.page'>): PayloadOf<'sync.ack'> {
    const run = m.runId ? this.runs.get(m.runId) : undefined
    const lib = this.d.lib()
    if (!run || run.finished || !lib) {
      return { runId: m.runId ?? '', decision: 'stop', outcome: 'aborted' }
    }
    const now = this.d.now()
    run.lastActivity = now
    const p = run.platform
    const b = this.budget(lib, p)
    b.spend('page', now)
    const parsed: PageParseResult = parseSyncPage(p, m.json, { requestCursor: run.requestCursor })
    if (!parsed.ok) {
      const outcome = parsed.error.code as SyncOutcome
      this.finish(run, outcome, parsed.error.reason)
      return { runId: run.runId, decision: 'stop', outcome }
    }
    const mode: RunMode = run.mode
    const res = ingestPage(
      { lib, prefs: () => this.d.prefs(), now: () => this.d.now() },
      { platform: p, mode, posts: parsed.posts, order: run.order, runStartedAt: run.startedAt },
    )
    run.pages += 1
    run.newItems += res.stats.new
    run.known += res.stats.known
    run.requestCursor = parsed.nextCursor
    this.afterIngest(lib, res.createdUuids)
    let decision: 'continue' | 'stop' = parsed.nextCursor ? 'continue' : 'stop'
    if (mode === 'incremental' && res.stopIncremental) decision = 'stop'
    if (mode === 'backfill') {
      lib.repos.sync.patchState(p, {
        backfillCursor: parsed.nextCursor,
        backfillAnchorAt: parsed.nextCursor ? run.order.anchorAt : null,
        backfillPos: parsed.nextCursor ? run.order.pos : 0,
        ...(parsed.nextCursor ? {} : { backfillDone: true }),
      })
    }
    if (mode === 'deep' && !parsed.nextCursor) lib.repos.sync.patchState(p, { lastDeepAt: now })
    let delayMs: number | undefined
    if (decision === 'continue') {
      const next = b.check('page', now)
      if (!next.ok) {
        decision = 'stop'
        if (next.reason === 'day' || next.reason === 'cooldown') {
          this.finish(run, 'rate_limited', next.reason === 'day' ? 'budget' : 'cooldown')
          return { runId: run.runId, decision, outcome: 'rate_limited', stats: res.stats }
        }
      } else delayMs = next.waitMs
    }
    if (decision === 'stop') this.finish(run, 'ok')
    else this.publish()
    return {
      runId: run.runId,
      decision,
      nextCursor: decision === 'continue' ? parsed.nextCursor : null,
      ...(delayMs !== undefined ? { delayMs } : {}),
      stats: res.stats,
      ...(decision === 'stop' ? { outcome: 'ok' as const } : {}),
    }
  }

  /** Capture passive (visite de la page des favoris) : ingérée sans requête supplémentaire. */
  onPassive(m: PayloadOf<'capture.passive'>): number {
    const lib = this.d.lib()
    if (!lib || !this.state(lib, m.platform).enabled) return 0
    const parsed = parseSyncPage(m.platform, m.json)
    if (!parsed.ok) return 0
    const now = this.d.now()
    const order = this.passiveOrder.get(m.platform) ?? { anchorAt: now, pos: 0 }
    const res = ingestPage(
      { lib, prefs: () => this.d.prefs(), now: () => this.d.now() },
      { platform: m.platform, mode: 'passive', posts: parsed.posts, order, runStartedAt: now },
    )
    this.passiveOrder.set(m.platform, order)
    this.afterIngest(lib, res.createdUuids)
    if (res.stats.new) {
      const st = this.state(lib, m.platform)
      lib.repos.sync.patchState(m.platform, {
        lastNewCount: res.stats.new,
        totalSynced: st.total_synced + res.stats.new,
        lastSuccessAt: now,
      })
      this.publish()
    }
    return res.stats.new
  }

  private afterIngest(lib: LibraryContext, uuids: string[]): void {
    if (!uuids.length) return
    emitItemsChanged(uuids, 'created')
    this.d.kickJobs()
    const ids = (
      lib.db
        .prepare(
          `SELECT id FROM items WHERE uuid IN (SELECT value FROM json_each(?)) AND kind = 'tweet'
             AND NOT EXISTS (SELECT 1 FROM item_media m WHERE m.item_id = items.id)`,
        )
        .all(JSON.stringify(uuids)) as { id: number }[]
    ).map((r) => r.id)
    if (ids.length) this.d.renderCards(ids)
  }

  /** Fin de run (message de l'extension, décision de l'app, ou abandon). Idempotent. */
  finish(
    run: RunCtx,
    outcome: SyncOutcome,
    error?: string,
    resetAt?: number,
    target?: string,
  ): void {
    if (run.finished) {
      if (target)
        this.d
          .lib()
          ?.db.prepare('UPDATE sync_runs SET target = ? WHERE id = ?')
          .run(target, run.runId)
      return
    }
    run.finished = true
    this.runs.delete(run.runId)
    const lib = this.d.lib()
    if (!lib) return
    const p = run.platform
    const now = this.d.now()
    const st = this.state(lib, p)
    const b = this.budget(lib, p)
    const failure = ['api_changed', 'network', 'rate_limited'].includes(outcome)
    let status: string
    let lastError: string | null = null
    switch (outcome) {
      case 'ok':
        status = 'ok'
        b.success()
        break
      case 'rate_limited':
        status = 'rate_limited'
        b.cooldown(now, resetAt)
        break
      case 'auth_required':
        status = 'auth_required'
        break
      case 'blocked':
        status = 'auth_required'
        lastError = 'blocked'
        break
      case 'permissions':
        status = 'auth_required'
        lastError = 'permissions'
        break
      case 'api_changed':
        status = 'api_changed'
        break
      case 'waiting_for_tab':
        status = 'waiting_for_tab'
        break
      case 'network':
        status = 'error'
        lastError = 'network'
        break
      default:
        status = st.status === 'running' ? 'idle' : st.status
    }
    lib.repos.sync.finishRun(
      run.runId,
      {
        status: outcome,
        pages: run.pages,
        newItems: run.newItems,
        knownItems: run.known,
        error: error ?? null,
      },
      now,
    )
    if (target)
      lib.db.prepare('UPDATE sync_runs SET target = ? WHERE id = ?').run(target, run.runId)
    lib.repos.sync.patchState(p, {
      status,
      lastError,
      ...(outcome === 'ok'
        ? {
            lastSuccessAt: now,
            lastNewCount: run.newItems,
            totalSynced: st.total_synced + run.newItems,
            consecutiveFailures: 0,
          }
        : {}),
      ...(failure ? { consecutiveFailures: st.consecutive_failures + 1 } : {}),
    })
    if (!OK_STATES.has(status))
      this.d.log.warn(`[sync] ${p} : ${outcome}${error ? ` (${error})` : ''}`)
    this.publish()
  }

  onFinished(m: PayloadOf<'sync.finished'>): void {
    const run = this.runs.get(m.runId)
    if (run) this.finish(run, m.status, m.error, m.resetAt, m.target)
    else if (m.target)
      this.d
        .lib()
        ?.db.prepare('UPDATE sync_runs SET target = ? WHERE id = ? AND target IS NULL')
        .run(m.target, m.runId)
  }

  // ------------------------------------------------------------------ Instagram : URL signées

  /** 403/410 sur une URL Instagram : `item.refresh` dans le budget (1 fois par heure et par élément). */
  onExpiredUrl(url: string): void {
    const lib = this.d.lib()
    const bridge = this.d.bridge()
    if (!lib || !bridge) return
    const row = lib.db
      .prepare(
        `SELECT i.external_id AS code FROM item_media m JOIN items i ON i.id = m.item_id
         WHERE m.remote_url = ? AND i.source = 'instagram' LIMIT 1`,
      )
      .get(url) as { code: string | null } | undefined
    if (!row?.code) return
    const now = this.d.now()
    if ((this.refreshed.get(row.code) ?? 0) > now - 3_600_000) return
    const b = this.budget(lib, 'instagram')
    if (!b.check('refresh', now).ok) return
    const client = this.pickClient('instagram')
    if (!client) return
    b.spend('refresh', now)
    this.refreshed.set(row.code, now)
    bridge.send(client.connId, 'item.refresh', { platform: 'instagram', externalId: row.code })
  }

  /** `item.data` : URL fraîches → médias remis en file. */
  onItemData(m: PayloadOf<'item.data'>): number {
    const lib = this.d.lib()
    if (!lib || m.platform !== 'instagram') return 0
    const parsed = parseInstagramMediaInfo(m.json)
    if (!parsed.ok) return 0
    const post = parsed.posts.find((p) => p.externalId === m.externalId) ?? parsed.posts[0]
    if (!post) return 0
    const item = lib.db
      .prepare("SELECT id, uuid FROM items WHERE source = 'instagram' AND external_id = ?")
      .get(m.externalId) as { id: number; uuid: string } | undefined
    if (!item) return 0
    let n = 0
    lib.db.transaction(() => {
      const media = lib.repos.media.listByItem(item.id)
      post.media.forEach((nm, i) => {
        const row = media.find((x) => x.position === i)
        if (!row || (row.status !== 'missing' && row.status !== 'remote') || !nm.url) return
        lib.repos.media.update(row.id, {
          status: 'remote',
          remoteUrl: nm.url,
          remotePosterUrl: nm.posterUrl,
        })
        lib.repos.jobs.enqueue({
          type: 'media.download',
          itemId: item.id,
          dedupeKey: `dl:${row.id}:${this.d.now()}`,
          payload: { mediaId: row.id },
          priority: downloadPriority('instagram'),
        })
        n += 1
      })
      for (const a of post.authors) {
        if (a.handle)
          authorSeen(
            lib,
            { platform: 'instagram', handle: a.handle, name: a.name, avatarUrl: a.avatarUrl },
            this.d.now(),
          )
      }
    })()
    if (n) {
      emitItemsChanged([item.uuid], 'updated')
      this.d.kickJobs()
    }
    return n
  }

  onAuthorSeen(m: PayloadOf<'author.seen'>): void {
    const lib = this.d.lib()
    if (lib && authorSeen(lib, m, this.d.now())) this.d.kickJobs()
  }

  // ------------------------------------------------------------------ enregistrement d'une publication

  /** `save.create {kind:'post'}` (bouton injecté, popup) : la publication passe par l'ingestion de sync. */
  savePost(
    req: SaveRequest,
    collectionUuid: string | null,
    toPost: (r: SaveRequest) => NormalizedPost | null,
  ): IngestResult {
    const lib = this.d.lib()
    if (!lib) throw new Error(mt().errors.noLibrary)
    const post = toPost(req)
    if (!post) throw new Error('Publication illisible.')
    const now = this.d.now()
    const res = ingestPage(
      { lib, prefs: () => this.d.prefs(), now: () => this.d.now() },
      {
        platform: post.platform,
        mode: 'incremental',
        posts: [post],
        order: { anchorAt: now, pos: 0 },
        runStartedAt: now,
      },
    )
    const row = lib.db
      .prepare(
        'SELECT id, uuid, deleted_at FROM items WHERE source = ? AND external_id = ? ORDER BY created_at LIMIT 1',
      )
      .get(post.platform, post.externalId) as
      { id: number; uuid: string; deleted_at: number | null } | undefined
    if (!row) throw new Error(mt().errors.postDiscarded)
    if (collectionUuid) {
      const cid = lib.repos.collections.idByUuid(collectionUuid)
      if (cid !== undefined) lib.repos.collections.addItems(cid, [row.id])
    }
    if (req.note) lib.repos.items.update(row.id, { notes: req.note })
    this.afterIngest(lib, res.createdUuids)
    if (!res.createdUuids.length) emitItemsChanged([row.uuid], 'updated')
    return { itemUuid: row.uuid, status: res.stats.new ? 'created' : 'duplicate' }
  }

  recoveredUuids(p?: BridgePlatform): string[] {
    const lib = this.d.lib()
    if (!lib) return []
    return (
      lib.db
        .prepare(
          `SELECT i.uuid FROM sync_items s JOIN items i ON i.id = s.item_id
           WHERE s.recovered_at IS NOT NULL AND i.deleted_at IS NULL ${p ? 'AND s.source = ?' : ''}
           ORDER BY i.created_at DESC LIMIT 5000`,
        )
        .all(...(p ? [p] : [])) as { uuid: string }[]
    ).map((r) => r.uuid)
  }

  ackRecovered(p?: BridgePlatform): void {
    const lib = this.d.lib()
    if (!lib) return
    lib.db
      .prepare(
        `UPDATE sync_items SET recovered_at = NULL WHERE recovered_at IS NOT NULL ${p ? 'AND source = ?' : ''}`,
      )
      .run(...(p ? [p] : []))
    this.publish()
  }

  clearImportedFlag(p: BridgePlatform): void {
    const lib = this.d.lib()
    if (!lib) return
    const flags = (lib.repos.settings.get(IMPORTED_FLAGS_KEY) ?? {}) as Record<string, unknown>
    delete flags[p]
    lib.repos.settings.set(IMPORTED_FLAGS_KEY, flags)
    this.publish()
  }

  /** Arrêt : runs abandonnés proprement. */
  dispose(): void {
    for (const t of this.hintTimers.values()) clearTimeout(t)
    for (const r of [...this.runs.values()]) this.finish(r, 'aborted', 'arrêt de l’app')
  }
}
