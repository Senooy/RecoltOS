/**
 * Service IA : exécution des jobs `ai.enrich` / `ai.prompt` de la file
 * unique `jobs`, routage par fournisseur, budget, journal, lots, estimation, aperçu, instantané.
 *
 * Règles d'or : AUCUN appel sans `consentVersion` ni avec `provider = 'off'` ; jamais
 * pour un élément ou une collection `ai_excluded`. Les jobs déjà en base (ingestion, import d'une
 * ancienne bibliothèque) sont revérifiés à l'exécution.
 */
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AI_CONSENT_VERSION,
  AI_FIELDS,
  AiError,
  type AiCliId,
  type AiField,
  type AiInput,
  type AiTask,
  type ProviderStatus,
  type ProviderTestResult,
} from '../../shared/ai-types'
import type { AiCallEntry, AiEstimate, QueueSnapshot } from '../../shared/dto/ai'
import { AppError } from '../../shared/errors'
import type { EventName, EventPayload } from '../../shared/ipc'
import { JOB_PRIORITY, type JobOutcome, type JobRecord } from '../../shared/jobs'
import type { Prefs, PrefsPatch } from '../../shared/prefs'
import type { ItemRow } from '../db/repos/items'
import type { JobContext, JobServices } from '../jobs/handlers/types'
import type { JobQueue } from '../jobs/queue'
import type { LibraryContext } from '../library/library-context'
import { applyAnalysis, applyImagePrompt } from './apply'
import { OVERRIDE_SETTING, canStart, usage } from './budget'
import {
  averageDurationMs,
  clearCalls,
  listCalls,
  logCall,
  outcomeOf,
  purgeOldCalls,
} from './calls'
import { AI_MAX_ATTEMPTS, aiBackoffMs, ratePauseMs, toAiError } from './errors'
import { ProviderGate } from './gate'
import { buildAiInput } from './input'
import { purgeOldJobDirs } from './media'
import { promptSha256, previewOf, sentFilesOf, type PayloadPreview } from './privacy'
import { SYSTEM_FR, buildAnalyzePrompt, buildImagePromptPrompt, sentTextChars } from './prompts'
import { createProviders, type ProviderRegistry } from './providers'
import { syntheticInput } from './synthetic'
import { buildVocabulary } from './tags'

export const AI_JOB_TYPES = ['ai.enrich', 'ai.prompt'] as const
export const BARE_MESSAGE =
  'claude -p est peut-être passé en mode « bare » après une mise à jour : l’abonnement n’est plus lu. La file est en pause.'
const WAIT_MANUAL_MS = 10 * 60_000
const SNAPSHOT_THROTTLE_MS = 250

export interface AiJobPayload {
  force?: boolean
  fields?: AiField[]
  /** `autoAnalyzeOnSave` seul : le titre n'est pas appliqué. */
  noTitle?: boolean
  explicitTitle?: boolean
  failedOn?: string[]
}

export interface AiServiceDeps {
  userData: string
  prefs(): Prefs
  setPrefs(patch: PrefsPatch): Prefs
  emit<E extends EventName>(event: E, payload: EventPayload<E>): void
  services(): JobServices | null
  queue(): JobQueue | null
  log: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void }
  clock?: () => number
  providers?: ProviderRegistry
}

interface Plan {
  id: string
  scope: 'unanalyzed' | 'regenerate-fr' | 'all' | 'import' | 'collection'
  label: string
  ids: number[]
  collectionUuid?: string
  createdAt: number
}

const ELIGIBLE = `i.deleted_at IS NULL AND i.ai_excluded = 0 AND NOT EXISTS (
  SELECT 1 FROM collection_items ci JOIN collections c ON c.id = ci.collection_id
  WHERE ci.item_id = i.id AND c.ai_excluded = 1)`

export function isExcluded(lib: LibraryContext, itemId: number): boolean {
  return (
    lib.db.prepare(`SELECT 1 FROM items i WHERE i.id = ? AND ${ELIGIBLE}`).get(itemId) === undefined
  )
}

/** Charge utile d'un job créé à l'enregistrement (« Déclenchement à l'enregistrement »). */
export function autoJobPayload(ai: Prefs['ai']): AiJobPayload | null {
  if (ai.autoNameOnSave && ai.autoAnalyzeOnSave) return {}
  if (ai.autoNameOnSave) return { fields: ['title'] }
  if (ai.autoAnalyzeOnSave) return { noTitle: true }
  return null
}

export class AiService {
  readonly providers: ProviderRegistry
  readonly gate: ProviderGate
  private readonly deps: AiServiceDeps
  private readonly statuses: Partial<Record<AiCliId, ProviderStatus>> = {}
  private readonly versionChangedAt: Partial<Record<AiCliId, number>> = {}
  private readonly plans = new Map<string, Plan>()
  private snapTimer: NodeJS.Timeout | null = null
  private hardCapped: AiCliId | null = null

  constructor(deps: AiServiceDeps) {
    this.deps = deps
    this.providers =
      deps.providers ??
      createProviders({
        userData: deps.userData,
        prefs: () => deps.prefs(),
        makeTestInput: (dir) => {
          const s = this.requireServices()
          return syntheticInput(s.media, dir)
        },
      })
    this.gate = new ProviderGate({
      prefs: () => deps.prefs().ai,
      status: (p) => this.statuses[p],
      settings: () => deps.services()?.lib.repos.settings ?? null,
      clock: () => this.now(),
    })
  }

  private now(): number {
    return (this.deps.clock ?? Date.now)()
  }

  private requireServices(): JobServices {
    const s = this.deps.services()
    if (!s) throw new AppError('library_unavailable', 'Aucune bibliothèque ouverte.')
    return s
  }

  private framesDir(): string {
    return join(this.deps.userData, 'cache', 'frames')
  }

  /** Ouverture d'une bibliothèque : rétention du journal, purge des dossiers de job > 1 h. */
  async onLibraryOpen(lib: LibraryContext): Promise<void> {
    purgeOldCalls(lib.db, this.now())
    for (const p of ['claude', 'codex'] as const)
      await purgeOldJobDirs(join(this.providers.sandboxDir(p), 'jobs'), this.now()).catch(() => 0)
    this.scheduleSnapshot()
  }

  // ---------------------------------------------------------------- consentement, fournisseurs

  private assertEnabled(): Prefs['ai'] {
    const ai = this.deps.prefs().ai
    if (ai.provider === 'off')
      throw new AppError('ai_disabled', 'Choisis d’abord un fournisseur dans Réglages › IA.')
    if (!ai.consentVersion || ai.consentVersion < AI_CONSENT_VERSION)
      throw new AppError(
        'ai_consent_required',
        'Accepte d’abord les conditions d’envoi (Réglages › IA).',
      )
    return ai
  }

  consent(version: number): void {
    if (version < AI_CONSENT_VERSION)
      throw new AppError('validation', 'Version de consentement périmée.')
    this.deps.setPrefs({ ai: { consentVersion: version, consentAt: this.now() } })
    this.deps.queue()?.kick()
    this.scheduleSnapshot()
  }

  async statusOf(p: AiCliId): Promise<ProviderStatus> {
    const st = await this.providers.get(p).status()
    this.statuses[p] = st
    const prefs = this.deps.prefs()
    const seen = prefs.ai.lastSeenVersions[p]
    if (st.version && st.version !== seen) {
      if (seen) this.versionChangedAt[p] = this.now()
      this.deps.setPrefs({
        ai: { lastSeenVersions: { ...prefs.ai.lastSeenVersions, [p]: st.version } },
      })
    }
    if (this.deps.services()) {
      const pause = this.gate.paused()[p]
      if (!st.installed) this.gate.pause(p, { reason: 'NOT_INSTALLED' })
      else if (st.loggedIn === false) this.gate.pause(p, { reason: 'NOT_AUTHENTICATED' })
      else if (
        pause &&
        (pause.reason === 'NOT_AUTHENTICATED' || pause.reason === 'NOT_INSTALLED')
      ) {
        this.gate.resume(p)
        this.deps.queue()?.kick()
      }
    }
    return st
  }

  async detect(): Promise<{ claude: ProviderStatus; codex: ProviderStatus }> {
    this.providers.refresh()
    const [claude, codex] = await Promise.all([this.statusOf('claude'), this.statusOf('codex')])
    this.scheduleSnapshot()
    return { claude, codex }
  }

  /** Test niveau 1 (gratuit) ou niveau 2 (un vrai appel, journalisé). */
  async test(p: AiCliId, live: boolean): Promise<ProviderTestResult> {
    const status = await this.statusOf(p)
    if (!live || !status.installed || status.loggedIn === false) {
      return {
        ok: status.installed && status.loggedIn !== false,
        status,
        ...(!status.installed
          ? { error: 'CLI introuvable' }
          : status.loggedIn === false
            ? { error: 'Non connecté' }
            : {}),
      }
    }
    this.assertEnabled()
    const s = this.requireServices()
    const dir = join(this.providers.sandboxDir(p), 'jobs', `test-${randomUUID()}`)
    const ac = new AbortController()
    let input: AiInput | null = null
    const started = this.now()
    try {
      input = await syntheticInput(s.media, dir)
      const r = await this.providers
        .get(p)
        .analyze(input, { signal: ac.signal, timeoutMs: 120_000, jobDir: dir })
      logCall(s.lib.db, {
        ts: this.now(),
        jobId: null,
        itemId: null,
        priority: JOB_PRIORITY.MANUAL,
        provider: p,
        model: r.meta.model ?? null,
        task: 'test',
        meta: r.meta,
        outcome: 'ok',
        errorCode: null,
      })
      return {
        ok: true,
        status,
        latencyMs: r.meta.durationMs,
        ...(r.meta.model ? { model: r.meta.model } : {}),
      }
    } catch (err) {
      const e = toAiError(err)
      if (input && !['NOT_INSTALLED', 'UNSUPPORTED_CLI', 'DISABLED'].includes(e.code)) {
        const prompt = buildAnalyzePrompt(input, p)
        logCall(s.lib.db, {
          ts: this.now(),
          jobId: null,
          itemId: null,
          priority: JOB_PRIORITY.MANUAL,
          provider: p,
          model: null,
          task: 'test',
          meta: { ...this.descriptor(input, prompt), durationMs: this.now() - started },
          outcome: outcomeOf(e.code),
          errorCode: e.code,
        })
      }
      return { ok: false, status, error: `${e.code} : ${e.message}` }
    } finally {
      await rm(dir, { recursive: true, force: true })
      this.scheduleSnapshot()
    }
  }

  private descriptor(input: AiInput, prompt: string) {
    return {
      sentFiles: sentFilesOf(input),
      sentTextChars: sentTextChars(SYSTEM_FR, prompt),
      promptSha256: promptSha256(SYSTEM_FR, prompt),
    }
  }

  // ---------------------------------------------------------------- exécution d'un job

  async handleJob(job: JobRecord, ctx: JobContext): Promise<JobOutcome> {
    this.scheduleSnapshot()
    try {
      return await this.runJob(job, ctx)
    } finally {
      this.scheduleSnapshot()
    }
  }

  private setState(lib: LibraryContext, itemId: number, state: ItemRow['ai_state']): void {
    lib.repos.items.update(itemId, { aiState: state })
  }

  private async runJob(job: JobRecord, ctx: JobContext): Promise<JobOutcome> {
    const lib = ctx.lib
    const now = this.now()
    const item = job.itemId !== null ? lib.repos.items.getById(job.itemId) : undefined
    if (!item || item.deleted_at !== null) return { status: 'done' }
    const ai = ctx.prefs().ai
    const payload = job.payload as AiJobPayload & { failedOn: string[] }
    const task: AiTask = job.type === 'ai.prompt' ? 'imagePrompt' : 'analyze'
    // Revérification à l'exécution : jamais d'appel sans fournisseur ni consentement.
    if (ai.provider === 'off' || !ai.consentVersion || ai.consentVersion < AI_CONSENT_VERSION) {
      if (item.ai_state === 'queued') this.setState(lib, item.id, 'none')
      return { status: 'done' }
    }
    if (isExcluded(lib, item.id)) {
      if (task === 'analyze') this.setState(lib, item.id, 'skipped')
      return { status: 'done' }
    }
    if (
      task === 'analyze' &&
      !payload.force &&
      !payload.fields &&
      item.ai_lang === 'fr' &&
      (item.ai_description ?? '') !== ''
    ) {
      if (item.ai_state !== 'done') this.setState(lib, item.id, 'done')
      return { status: 'done' }
    }

    const route = this.gate.route({ failedOn: payload.failedOn })
    if (!('provider' in route)) {
      return {
        status: 'defer',
        retryAt: route.waitUntil ?? now + WAIT_MANUAL_MS,
        error: { code: 'ai_waiting', message: route.reason },
      }
    }
    const provider = route.provider
    let priority = job.priority
    const override = Number(lib.repos.settings.get(OVERRIDE_SETTING) ?? 0)
    let d = canStart(lib.db, provider, priority, ai, now, override)
    if (!d.ok && d.demoteTo !== undefined) {
      priority = d.demoteTo
      lib.db.prepare('UPDATE jobs SET priority = ? WHERE id = ?').run(priority, job.id)
      d = canStart(lib.db, provider, priority, ai, now, override)
    }
    if (!d.ok) {
      this.hardCapped = d.reason === 'hardCap' ? provider : null
      return {
        status: 'defer',
        retryAt: now + (d.waitMs ?? 60_000),
        error: { code: `ai_budget_${d.reason ?? 'wait'}`, message: 'budget' },
      }
    }
    this.hardCapped = null
    lib.db.prepare('UPDATE jobs SET provider = ? WHERE id = ?').run(provider, job.id)
    // Le panneau Détails passe de « En file d'attente » à « Analyse en cours ».
    ctx.changed([item.uuid], 'updated')

    const jobDir = join(this.providers.sandboxDir(provider), 'jobs', String(job.id))
    const lastCode = this.lastErrorCode(lib, job.id)
    const fields: readonly AiField[] = payload.fields?.length ? payload.fields : AI_FIELDS
    let input: AiInput | null = null
    const started = this.now()
    try {
      const built = await buildAiInput(
        {
          lib,
          media: ctx.media,
          hasTool: (n) => ctx.hasTool(n),
          framesDir: this.framesDir(),
          signal: ctx.signal,
        },
        item,
        jobDir,
        task,
      )
      input = built.input
      const opts = {
        signal: ctx.signal,
        timeoutMs: input.media.length > 1 ? 180_000 : 120_000,
        jobDir,
        jobId: job.id,
        retry: lastCode === 'BAD_OUTPUT',
      }
      const p = this.providers.get(provider)
      if (task === 'imagePrompt') {
        const r = await p.imagePrompt(input, opts)
        this.logOk(lib, job, priority, provider, 'imagePrompt', r.meta)
        const row = applyImagePrompt(lib, item.id, r.value, this.now())
        if (row) this.announce(ctx, row.uuid)
      } else {
        const r = await p.analyzeFields(input, fields, opts)
        this.logOk(
          lib,
          job,
          priority,
          provider,
          fields.length === AI_FIELDS.length ? 'analyze' : fields.join('+'),
          r.meta,
        )
        const row = applyAnalysis(lib, item.id, r.value, r.meta, {
          fields,
          autoName: !payload.noTitle,
          titlePolicy: ai.titlePolicy,
          explicitTitle: payload.explicitTitle === true,
          force: payload.force === true,
          vocabulary: input.vocabulary.length ? input.vocabulary : buildVocabulary(lib.db),
          now: this.now(),
        })
        if (row) this.announce(ctx, row.uuid)
      }
      this.clearStrikes(provider)
      return { status: 'done' }
    } catch (err) {
      const e = toAiError(err)
      if (
        input &&
        !['NOT_INSTALLED', 'UNSUPPORTED_CLI', 'DISABLED', 'FILE_MISSING'].includes(e.code)
      ) {
        const prompt =
          task === 'imagePrompt'
            ? buildImagePromptPrompt(input, provider)
            : buildAnalyzePrompt(input, provider, { fields, retry: lastCode === 'BAD_OUTPUT' })
        logCall(lib.db, {
          ts: this.now(),
          jobId: job.id,
          itemId: item.id,
          priority,
          provider,
          model: null,
          task: task === 'imagePrompt' ? 'imagePrompt' : 'analyze',
          meta: { ...this.descriptor(input, prompt), durationMs: this.now() - started },
          outcome: outcomeOf(e.code),
          errorCode: e.code,
        })
      }
      const outcome = this.onError(e, job, provider, item, lib, ctx)
      ctx.changed([item.uuid], 'updated')
      return outcome
    } finally {
      await rm(jobDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private strikes: Partial<Record<AiCliId, number>> = {}
  private clearStrikes(p: AiCliId): void {
    delete this.strikes[p]
  }

  private lastErrorCode(lib: LibraryContext, jobId: number): string | null {
    const row = lib.repos.jobs.getRow(jobId)
    if (!row?.last_error) return null
    try {
      return (JSON.parse(row.last_error) as { code?: string }).code ?? null
    } catch {
      return null
    }
  }

  private logOk(
    lib: LibraryContext,
    job: JobRecord,
    priority: number,
    provider: AiCliId,
    task: string,
    meta: Parameters<typeof logCall>[1]['meta'] & { model?: string },
  ): void {
    logCall(lib.db, {
      ts: this.now(),
      jobId: job.id,
      itemId: job.itemId,
      priority,
      provider,
      model: meta.model ?? null,
      task,
      meta,
      outcome: 'ok',
      errorCode: null,
    })
  }

  private announce(ctx: JobContext, uuid: string): void {
    ctx.changed([uuid], 'updated')
    this.deps.emit('ai.result', { uuid })
  }

  private onError(
    e: AiError,
    job: JobRecord,
    provider: AiCliId,
    item: ItemRow,
    lib: LibraryContext,
    ctx: JobContext,
  ): JobOutcome {
    const now = this.now()
    const error = { code: e.code, message: e.message }
    switch (e.code) {
      case 'CANCELLED':
        throw new AppError('cancelled', 'annulé')
      case 'RATE_LIMITED': {
        const n = (this.strikes[provider] ?? 0) + 1
        this.strikes[provider] = n
        const until =
          e.opts?.resetAt && e.opts.resetAt > now ? e.opts.resetAt : now + ratePauseMs(n)
        this.gate.pause(provider, { reason: 'RATE_LIMITED', until, strikes: n })
        this.setProvider(lib, job.id, null)
        return { status: 'defer', retryAt: now, error }
      }
      case 'NOT_AUTHENTICATED': {
        const changed = this.versionChangedAt[provider]
        const bare = provider === 'claude' && changed !== undefined && now - changed < 86_400_000
        this.gate.pause(provider, { reason: 'NOT_AUTHENTICATED' })
        this.setProvider(lib, job.id, null)
        ctx.log.warn(`[ai] ${provider} : ${bare ? BARE_MESSAGE : 'non connecté'}`)
        return {
          status: 'defer',
          retryAt: now,
          error: bare ? { code: e.code, message: BARE_MESSAGE } : error,
        }
      }
      case 'NOT_INSTALLED':
        this.gate.pause(provider, { reason: 'NOT_INSTALLED' })
        this.setProvider(lib, job.id, null)
        return { status: 'defer', retryAt: now, error }
      case 'TIMEOUT':
      case 'PROCESS': {
        const failedOn = [...((job.payload.failedOn as string[] | undefined) ?? []), provider]
        lib.db
          .prepare(
            "UPDATE jobs SET payload = json_set(payload, '$.failedOn', json(?)) WHERE id = ?",
          )
          .run(JSON.stringify(failedOn), job.id)
        if (job.attempts >= job.maxAttempts) return this.fail(lib, item, error)
        return { status: 'retry', retryAt: now + aiBackoffMs(job.attempts), error }
      }
      case 'BAD_OUTPUT':
        if (job.attempts >= job.maxAttempts) return this.fail(lib, item, error)
        return { status: 'retry', retryAt: now + 2_000, error }
      default:
        // TOOL_VIOLATION, FILE_MISSING, UNSUPPORTED_CLI, DISABLED : définitif.
        return this.fail(lib, item, error)
    }
  }

  private fail(
    lib: LibraryContext,
    item: ItemRow,
    error: { code: string; message: string },
  ): JobOutcome {
    this.setState(lib, item.id, 'failed')
    return { status: 'failed', error }
  }

  private setProvider(lib: LibraryContext, jobId: number, p: string | null): void {
    lib.db.prepare('UPDATE jobs SET provider = ? WHERE id = ?').run(p, jobId)
  }

  /** Crochet d'échec définitif (tentatives épuisées). */
  onJobFailed(job: JobRecord, services: JobServices): void {
    if (job.itemId !== null && job.type === 'ai.enrich')
      services.lib.repos.items.update(job.itemId, { aiState: 'failed' })
    this.scheduleSnapshot()
  }

  // ---------------------------------------------------------------- sélection, estimation, file

  private idsFor(
    lib: LibraryContext,
    f: {
      missingDescription?: boolean
      regenerateFr?: boolean
      importRunId?: number
      collectionUuid?: string
      itemUuids?: string[]
    },
  ): number[] {
    const where: string[] = [ELIGIBLE]
    const params: unknown[] = []
    if (f.missingDescription) where.push("coalesce(i.ai_description, '') = ''")
    if (f.regenerateFr)
      where.push("coalesce(i.ai_description, '') <> '' AND coalesce(i.ai_lang, '') <> 'fr'")
    if (f.importRunId !== undefined) where.push("i.origin = 'gatheros'")
    if (f.collectionUuid) {
      where.push(
        'EXISTS (SELECT 1 FROM collection_items ci JOIN collections c ON c.id = ci.collection_id WHERE ci.item_id = i.id AND c.uuid = ?)',
      )
      params.push(f.collectionUuid)
    }
    if (f.itemUuids) {
      where.push('i.uuid IN (SELECT value FROM json_each(?))')
      params.push(JSON.stringify(f.itemUuids))
    }
    return (
      lib.db
        .prepare(
          `SELECT i.id FROM items i WHERE ${where.join(' AND ')} ORDER BY i.created_at DESC, i.id DESC`,
        )
        .all(...params) as { id: number }[]
    ).map((r) => r.id)
  }

  private etaSec(lib: LibraryContext, remaining: number): number {
    const ai = this.deps.prefs().ai
    const per = Math.max(averageDurationMs(lib.db) / ai.concurrency, 3_600_000 / ai.perHour)
    return Math.round((remaining * per) / 1000)
  }

  estimate(filter: Parameters<AiService['idsFor']>[1]): AiEstimate {
    const s = this.requireServices()
    const n = this.idsFor(s.lib, filter).length
    const p = this.deps.prefs().ai.provider
    return { count: n, provider: p === 'off' ? 'none' : p, calls: n, etaSec: this.etaSec(s.lib, n) }
  }

  enqueue(i: {
    itemUuids?: string[] | undefined
    filter?: Parameters<AiService['idsFor']>[1] | undefined
    task: AiTask
    force?: boolean | undefined
    fields?: AiField[] | undefined
  }): { queued: number } {
    this.assertEnabled()
    const s = this.requireServices()
    const ids = i.itemUuids
      ? this.idsFor(s.lib, { itemUuids: i.itemUuids })
      : this.idsFor(s.lib, i.filter ?? {})
    const manual = Boolean(i.itemUuids) && ids.length <= 20
    const n = this.enqueueIds(s, ids, {
      task: i.task,
      priority: manual ? JOB_PRIORITY.MANUAL : JOB_PRIORITY.BATCH,
      payload: {
        ...(i.force ? { force: true } : {}),
        ...(i.fields?.length ? { fields: i.fields } : {}),
        ...(i.fields?.length === 1 && i.fields[0] === 'title' && manual
          ? { explicitTitle: true }
          : {}),
      },
      batchId: null,
    })
    return { queued: n }
  }

  private enqueueIds(
    s: JobServices,
    ids: readonly number[],
    o: { task: AiTask; priority: number; payload: AiJobPayload; batchId: number | null },
  ): number {
    const now = this.now()
    const type = o.task === 'imagePrompt' ? 'ai.prompt' : 'ai.enrich'
    s.lib.db.transaction(() => {
      for (const id of ids) {
        s.lib.repos.jobs.enqueue(
          {
            type,
            itemId: id,
            dedupeKey: o.task === 'imagePrompt' ? `aiprompt:${id}` : `ai:${id}`,
            payload: { ...o.payload },
            priority: o.priority,
            maxAttempts: AI_MAX_ATTEMPTS,
            batchId: o.batchId,
          },
          now,
        )
        if (o.task === 'analyze') s.lib.repos.items.update(id, { aiState: 'queued' })
      }
    })()
    if (ids.length > 0) {
      const uuids = (
        s.lib.db
          .prepare('SELECT uuid FROM items WHERE id IN (SELECT value FROM json_each(?))')
          .all(JSON.stringify(ids)) as { uuid: string }[]
      ).map((r) => r.uuid)
      s.changed(uuids, 'updated')
    }
    s.kick()
    this.scheduleSnapshot()
    return ids.length
  }

  batchCreate(
    scope: Plan['scope'],
    collectionUuid?: string,
  ): { planId: string; label: string; estimate: AiEstimate } {
    const s = this.requireServices()
    const filter =
      scope === 'unanalyzed' || scope === 'import'
        ? { missingDescription: true }
        : scope === 'regenerate-fr'
          ? { regenerateFr: true }
          : scope === 'collection'
            ? { collectionUuid: collectionUuid ?? '' }
            : {}
    const ids = this.idsFor(s.lib, filter)
    const labels: Record<Plan['scope'], string> = {
      unanalyzed: 'Analyser les éléments non analysés',
      import: 'Enrichir la bibliothèque importée',
      'regenerate-fr': 'Régénérer en français',
      all: 'Tout analyser',
      collection: 'Analyser la collection',
    }
    const plan: Plan = {
      id: randomUUID(),
      scope,
      label: labels[scope],
      ids,
      ...(collectionUuid ? { collectionUuid } : {}),
      createdAt: this.now(),
    }
    this.plans.set(plan.id, plan)
    const p = this.deps.prefs().ai.provider
    return {
      planId: plan.id,
      label: plan.label,
      estimate: {
        count: ids.length,
        provider: p === 'off' ? 'none' : p,
        calls: ids.length,
        etaSec: this.etaSec(s.lib, ids.length),
      },
    }
  }

  batchStart(planId: string): { batchUuid: string } {
    this.assertEnabled()
    const plan = this.plans.get(planId)
    if (!plan) throw new AppError('not_found', 'Plan de lot introuvable ou expiré.')
    this.plans.delete(planId)
    const s = this.requireServices()
    const uuid = randomUUID()
    const batchId = Number(
      s.lib.db
        .prepare(
          `INSERT INTO ai_batches (uuid, label, scope, total, state, options, created_at)
           VALUES (?, ?, ?, ?, 'running', ?, ?)`,
        )
        .run(
          uuid,
          plan.label,
          plan.scope,
          plan.ids.length,
          JSON.stringify({ collectionUuid: plan.collectionUuid ?? null }),
          this.now(),
        ).lastInsertRowid,
    )
    this.enqueueIds(s, plan.ids, {
      task: 'analyze',
      priority: JOB_PRIORITY.BATCH,
      payload: plan.scope === 'regenerate-fr' || plan.scope === 'all' ? { force: true } : {},
      batchId,
    })
    return { batchUuid: uuid }
  }

  control(a: {
    action: 'pause' | 'resume' | 'cancel' | 'retryFailed'
    batchUuid?: string | undefined
    provider?: AiCliId | undefined
  }): void {
    const s = this.requireServices()
    const q = this.deps.queue()
    const now = this.now()
    if (a.action === 'pause') {
      if (a.provider) this.gate.pause(a.provider, { reason: 'USER' })
      else for (const t of AI_JOB_TYPES) q?.pauseType(t, null, 'user')
      if (a.batchUuid)
        s.lib.db
          .prepare("UPDATE ai_batches SET state = 'paused' WHERE uuid = ? AND state = 'running'")
          .run(a.batchUuid)
    } else if (a.action === 'resume') {
      if (a.provider) this.gate.resume(a.provider)
      else {
        for (const t of AI_JOB_TYPES) q?.resumeType(t)
        this.gate.resume()
      }
      s.lib.db.prepare("UPDATE ai_batches SET state = 'running' WHERE state = 'paused'").run()
      q?.kick()
    } else if (a.action === 'cancel') {
      const batchId = a.batchUuid
        ? ((
            s.lib.db.prepare('SELECT id FROM ai_batches WHERE uuid = ?').get(a.batchUuid) as
              { id: number } | undefined
          )?.id ?? -1)
        : null
      s.lib.db.transaction(() => {
        s.lib.db
          .prepare(
            `UPDATE items SET ai_state = 'none' WHERE ai_state = 'queued' AND id IN (
               SELECT item_id FROM jobs WHERE type IN ('ai.enrich','ai.prompt') AND state = 'queued'
               AND (? IS NULL OR batch_id = ?))`,
          )
          .run(batchId, batchId)
        s.lib.db
          .prepare(
            `UPDATE jobs SET state = 'cancelled', updated_at = ? WHERE type IN ('ai.enrich','ai.prompt')
             AND state = 'queued' AND (? IS NULL OR batch_id = ?)`,
          )
          .run(now, batchId, batchId)
        s.lib.db
          .prepare(
            `UPDATE ai_batches SET state = 'cancelled', finished_at = ? WHERE state IN ('running','paused')
             AND (? IS NULL OR id = ?)`,
          )
          .run(now, batchId, batchId)
      })()
    } else {
      for (const t of AI_JOB_TYPES) s.lib.repos.jobs.requeueFailed(t, now)
      s.lib.db
        .prepare(
          `UPDATE items SET ai_state = 'queued' WHERE ai_state = 'failed' AND id IN (
             SELECT item_id FROM jobs WHERE type = 'ai.enrich' AND state = 'queued')`,
        )
        .run()
      q?.kick()
    }
    this.scheduleSnapshot()
  }

  budgetOverride(until: number): void {
    this.requireServices().lib.repos.settings.set(OVERRIDE_SETTING, until)
    this.hardCapped = null
    this.deps.queue()?.kick()
    this.scheduleSnapshot()
  }

  callsList(limit: number): AiCallEntry[] {
    return listCalls(this.requireServices().lib.db, limit)
  }

  callsClear(): number {
    const n = clearCalls(this.requireServices().lib.db)
    this.scheduleSnapshot()
    return n
  }

  /** Aperçu exact de l'envoi : JPEG préparés, prompt système et prompt complet. */
  async previewPayload(
    itemUuid: string | undefined,
    task: AiTask,
  ): Promise<PayloadPreview & { provider: AiCliId; itemUuid: string }> {
    const s = this.requireServices()
    const pick =
      itemUuid ??
      (
        s.lib.db
          .prepare(
            `SELECT i.uuid FROM items i WHERE ${ELIGIBLE} AND i.hidden_at IS NULL
             ORDER BY (coalesce(i.ai_description, '') = '') DESC, i.created_at DESC LIMIT 1`,
          )
          .get() as { uuid: string } | undefined
      )?.uuid
    if (!pick) throw new AppError('not_found', 'Aucun élément à prévisualiser.')
    const item = s.lib.repos.items.getByUuid(pick)
    if (!item || item.deleted_at !== null) throw new AppError('not_found', 'Élément introuvable.')
    const pref = this.deps.prefs().ai.provider
    const provider: AiCliId = pref === 'off' ? 'claude' : pref
    const dir = join(this.providers.sandboxDir(provider), 'jobs', `preview-${randomUUID()}`)
    try {
      const { input } = await buildAiInput(
        { lib: s.lib, media: s.media, hasTool: (n) => s.hasTool(n), framesDir: this.framesDir() },
        item,
        dir,
        task,
      )
      const prompt =
        task === 'imagePrompt'
          ? buildImagePromptPrompt(input, provider)
          : buildAnalyzePrompt(input, provider)
      return { provider, itemUuid: item.uuid, ...(await previewOf(input, SYSTEM_FR, prompt)) }
    } catch (err) {
      const e = toAiError(err)
      throw new AppError(e.code === 'FILE_MISSING' ? 'not_found' : 'internal', e.message)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  // ---------------------------------------------------------------- instantané

  snapshot(): QueueSnapshot {
    const s = this.deps.services()
    const ai = this.deps.prefs().ai
    const now = this.now()
    const empty = { running: 0, queued: 0, done: 0, failed: 0 }
    const snap: QueueSnapshot = {
      cli: { ...empty, providers: { claude: { running: 0 }, codex: { running: 0 } } },
      palette: { ...empty },
      budget: { hourUsed: 0, hourLimit: ai.perHour, dayUsed: 0, dayLimit: ai.perDay },
    }
    if (!s) return snap
    const db = s.lib.db
    const counts = db
      .prepare(
        `SELECT state, count(*) AS n FROM jobs WHERE type IN ('ai.enrich','ai.prompt') GROUP BY state`,
      )
      .all() as { state: string; n: number }[]
    for (const c of counts) {
      if (c.state === 'running') snap.cli.running = c.n
      if (c.state === 'queued') snap.cli.queued = c.n
      if (c.state === 'done') snap.cli.done = c.n
      if (c.state === 'failed') snap.cli.failed = c.n
    }
    const perProv = db
      .prepare(
        `SELECT provider, count(*) AS n FROM jobs WHERE type IN ('ai.enrich','ai.prompt') AND state = 'running' AND provider IS NOT NULL GROUP BY provider`,
      )
      .all() as { provider: string; n: number }[]
    for (const r of perProv)
      if (r.provider === 'claude' || r.provider === 'codex')
        snap.cli.providers[r.provider].running = r.n
    const pal = db
      .prepare("SELECT state, count(*) AS n FROM jobs WHERE type = 'media.derive' GROUP BY state")
      .all() as { state: string; n: number }[]
    for (const c of pal) {
      if (c.state === 'running') snap.palette.running = c.n
      if (c.state === 'queued') snap.palette.queued = c.n
      if (c.state === 'done') snap.palette.done = c.n
      if (c.state === 'failed') snap.palette.failed = c.n
    }
    const q = this.deps.queue()
    const userPaused = q ? q.pausedUntil('ai.enrich') !== undefined : false
    const pauses = this.gate.paused()
    for (const p of ['claude', 'codex'] as const) {
      const x = pauses[p]
      if (userPaused) snap.cli.providers[p].paused = { reason: 'USER' }
      else if (this.hardCapped === p) snap.cli.providers[p].paused = { reason: 'HARD_CAP' }
      else if (x)
        snap.cli.providers[p].paused = {
          reason: x.reason,
          ...(x.until !== undefined ? { until: Math.round(x.until) } : {}),
        }
    }
    const prov = ai.provider === 'off' ? 'claude' : ai.provider
    const u = usage(db, prov, now)
    snap.budget.hourUsed = u.hour
    snap.budget.dayUsed = u.day
    // Lots : clôture des lots terminés, puis le plus récent actif.
    db.prepare(
      `UPDATE ai_batches SET state = 'done', finished_at = ? WHERE state = 'running' AND NOT EXISTS (
         SELECT 1 FROM jobs j WHERE j.batch_id = ai_batches.id AND j.state IN ('queued','running'))`,
    ).run(now)
    const b = db
      .prepare(
        `SELECT b.id, b.uuid, b.label, b.total,
           (SELECT count(*) FROM jobs j WHERE j.batch_id = b.id AND j.state IN ('done','cancelled')) AS done,
           (SELECT count(*) FROM jobs j WHERE j.batch_id = b.id AND j.state = 'failed') AS failed
         FROM ai_batches b WHERE b.state IN ('running','paused') ORDER BY b.id DESC LIMIT 1`,
      )
      .get() as
      { uuid: string; label: string; total: number; done: number; failed: number } | undefined
    if (b) {
      snap.batch = {
        uuid: b.uuid,
        label: b.label,
        total: b.total,
        done: b.done,
        failed: b.failed,
        etaSec: this.etaSec(s.lib, Math.max(0, b.total - b.done - b.failed)),
      }
    }
    return snap
  }

  scheduleSnapshot(): void {
    if (this.snapTimer) return
    this.snapTimer = setTimeout(() => {
      this.snapTimer = null
      try {
        this.deps.emit('ai.queue', this.snapshot())
      } catch (err) {
        this.deps.log.warn('[ai] instantané impossible', err)
      }
    }, SNAPSHOT_THROTTLE_MS)
    this.snapTimer.unref?.()
  }

  dispose(): void {
    if (this.snapTimer) clearTimeout(this.snapTimer)
    this.snapTimer = null
  }
}

// ---------------------------------------------------------------- registre

let service: AiService | null = null

export function setAiService(s: AiService | null): void {
  service = s
}
export function getAiService(): AiService | null {
  return service
}
export function requireAiService(): AiService {
  if (!service) throw new AppError('not_implemented', 'Service IA indisponible.')
  return service
}

export { AiError }
