/**
 * AI queue: real `jobs` table, real `JobQueue`, media-worker as a process, fake CLI.
 * Injected clock for the budget.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AI_CONSENT_VERSION } from '../../../src/shared/ai-types'
import { JOB_PRIORITY } from '../../../src/shared/jobs'
import { PrefsSchema, type Prefs } from '../../../src/shared/prefs'
import { canStart } from '../../../src/main/ai/budget'
import { runCli } from '../../../src/main/ai/cli/spawn'
import { createProviders } from '../../../src/main/ai/providers'
import { AiService, setAiService } from '../../../src/main/ai/service'
import { runSearch } from '../../../src/main/search/search'
import { REPO_ROOT } from '../../helpers'
import { makeHarness, type JobsHarness } from '../jobs/helpers'

const FAKE_CLAUDE = join(REPO_ROOT, 'tests/helpers/fake-bin/claude')
const FAKE_CODEX = join(REPO_ROOT, 'tests/helpers/fake-bin/codex')

let h: JobsHarness
let svc: AiService
let ud: string
let log: string
let clock: { now: number }
let modes: { claude: string; codex: string }
let prefs: Prefs
const events: { event: string; payload: unknown }[] = []

function setup(ai: Record<string, unknown> = {}) {
  clock = { now: 1_800_000_000_000 }
  ud = mkdtempSync(join(tmpdir(), 'recolt-aiq-'))
  log = join(ud, 'argv.log')
  modes = { claude: 'ok', codex: 'ok' }
  prefs = PrefsSchema.parse({
    ai: {
      provider: 'claude',
      fallback: 'none',
      consentVersion: AI_CONSENT_VERSION,
      minGapMs: 0,
      claude: { path: FAKE_CLAUDE, model: 'claude-haiku-5-5' },
      codex: { path: FAKE_CODEX },
      ...ai,
    },
  })
  h = makeHarness({ clock: () => clock.now })
  // The queue reads the harness preferences: we replace them with the test's.
  h.services.prefs = () => prefs
  const providers = createProviders({
    userData: ud,
    prefs: () => prefs,
    detect: { shell: () => Promise.resolve('') },
    loginPath: () => Promise.resolve(process.env.PATH ?? null),
    run: (o) =>
      runCli({
        ...o,
        env: {
          ...o.env,
          FAKE_CLI_MODE: o.bin.endsWith('codex') ? modes.codex : modes.claude,
          FAKE_CLI_LOG: log,
        },
      }),
  })
  events.length = 0
  svc = new AiService({
    userData: ud,
    prefs: () => prefs,
    setPrefs: (patch) => {
      prefs = PrefsSchema.parse({ ...prefs, ai: { ...prefs.ai, ...(patch.ai ?? {}) } })
      return prefs
    },
    emit: (event, payload) => events.push({ event, payload }),
    services: () => h.services,
    queue: () => h.queue,
    log: h.services.log,
    clock: () => clock.now,
    providers,
  })
  setAiService(svc)
}

beforeEach(() => setup())
afterEach(async () => {
  setAiService(null)
  svc.dispose()
  await h.cleanup()
  rmSync(ud, { recursive: true, force: true })
})

async function addImage(over: Record<string, unknown> = {}): Promise<{ id: number; uuid: string }> {
  const rel = `items/ab/${Math.random().toString(36).slice(2)}.jpg`
  const abs = h.lib.paths.abs(rel)
  mkdirSync(dirname(abs), { recursive: true })
  await sharp({ create: { width: 300, height: 200, channels: 3, background: '#a03020' } })
    .jpeg()
    .toFile(abs)
  return h.lib.repos.items.insertWithMedia({ kind: 'image', source: 'local', ...over }, [
    { mediaType: 'image', fileRel: rel, status: 'ok', width: 300, height: 200 },
  ])
}

const argvLines = (): { bin: string; args: string[] }[] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { bin: string; args: string[] })
        .filter((x) => x.args.includes('-p') || x.args[0] === 'exec')
    : []

const calls = () =>
  h.lib.db.prepare('SELECT * FROM ai_calls ORDER BY id').all() as {
    provider: string
    model: string | null
    outcome: string
    task: string
    error_code: string | null
    item_id: number | null
  }[]

async function run() {
  h.queue.start()
  await h.queue.whenIdle()
}

describe('application and search', () => {
  it('full analysis: description, title, AI tags, OCR, FTS, log, event', async () => {
    const it1 = await addImage()
    expect(svc.enqueue({ itemUuids: [it1.uuid], task: 'analyze' })).toEqual({ queued: 1 })
    expect(h.lib.repos.items.getById(it1.id)!.ai_state).toBe('queued')
    await run()
    const row = h.lib.repos.items.getById(it1.id)!
    expect(row).toMatchObject({
      ai_state: 'done',
      ai_lang: 'fr',
      ai_provider: 'claude',
      ai_model: 'claude-haiku-5-5',
      title: 'Titre synthétique',
      title_source: 'ai',
      ai_description: 'Description synthétique en français.',
      ocr_text: 'TEXTE',
    })
    const tags = h.lib.db
      .prepare(
        'SELECT t.name, it.source FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ? ORDER BY t.name',
      )
      .all(it1.id)
    expect(tags).toEqual([
      { name: 'affiche', source: 'ai' },
      { name: 'graphic-design', source: 'ai' },
      { name: 'typographie', source: 'ai' },
    ])
    expect(calls()).toMatchObject([
      { provider: 'claude', model: 'claude-haiku-5-5', outcome: 'ok', task: 'analyze' },
    ])
    expect(runSearch(h.lib.db, { q: 'synthétique', limit: 10 }).rows.map((r) => r.uuid)).toEqual([
      it1.uuid,
    ])
    expect(runSearch(h.lib.db, { q: 'graphic', limit: 10 }).total).toBe(1)
    expect(events.some((e) => e.event === 'ai.result')).toBe(true)
    expect(h.changes.some((c) => c.uuids.includes(it1.uuid))).toBe(true)
  })

  it('user title never overwritten; "import" only under the "always" policy', async () => {
    const u = await addImage({ title: 'Mon titre', titleSource: 'user' })
    const imp = await addImage({ title: 'Imported', titleSource: 'import' })
    svc.enqueue({ itemUuids: [u.uuid, imp.uuid], task: 'analyze' })
    await run()
    expect(h.lib.repos.items.getById(u.id)).toMatchObject({
      title: 'Mon titre',
      ai_title: 'Titre synthétique',
    })
    expect(h.lib.repos.items.getById(imp.id)!.title).toBe('Imported')
    prefs = PrefsSchema.parse({ ...prefs, ai: { ...prefs.ai, titlePolicy: 'always' } })
    svc.enqueue({ itemUuids: [u.uuid, imp.uuid], task: 'analyze', force: true })
    await run()
    expect(h.lib.repos.items.getById(u.id)!.title).toBe('Mon titre')
    expect(h.lib.repos.items.getById(imp.id)!.title).toBe('Titre synthétique')
  })

  it('user tags kept, ai tags replaced', async () => {
    const it1 = await addImage()
    h.lib.repos.tags.addToItems([it1.id], ['perso'], 'user')
    h.lib.repos.tags.addToItems([it1.id], ['ancien-ia'], 'ai')
    svc.enqueue({ itemUuids: [it1.uuid], task: 'analyze' })
    await run()
    const names = (
      h.lib.db
        .prepare(
          'SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ?',
        )
        .all(it1.id) as { name: string }[]
    ).map((r) => r.name)
    expect(names).toContain('perso')
    expect(names).not.toContain('ancien-ia')
  })
})

describe('consent and exclusions', () => {
  it('without consent: enqueue refused; a job already in the database triggers no call', async () => {
    prefs = PrefsSchema.parse({ ...prefs, ai: { ...prefs.ai, consentVersion: undefined } })
    const it1 = await addImage()
    expect(() => svc.enqueue({ itemUuids: [it1.uuid], task: 'analyze' })).toThrow(/conditions/)
    h.lib.repos.jobs.enqueue({ type: 'ai.enrich', itemId: it1.id, dedupeKey: `ai:${it1.id}` })
    h.lib.repos.items.update(it1.id, { aiState: 'queued' })
    await run()
    expect(argvLines()).toHaveLength(0)
    expect(h.lib.repos.items.getById(it1.id)!.ai_state).toBe('none')
  })

  it('provider "off": enqueue refused', async () => {
    prefs = PrefsSchema.parse({ ...prefs, ai: { ...prefs.ai, provider: 'off' } })
    const it1 = await addImage()
    expect(() => svc.enqueue({ itemUuids: [it1.uuid], task: 'analyze' })).toThrow(/fournisseur/)
  })

  it('item or collection excluded: never sent', async () => {
    const a = await addImage({ aiExcluded: true })
    const b = await addImage()
    const c = h.lib.repos.collections.create({ name: 'Privé', aiExcluded: true })
    h.lib.repos.collections.addItems(c.id, [b.id])
    // enqueue filters; an injected job is also ignored at execution.
    expect(svc.enqueue({ itemUuids: [a.uuid, b.uuid], task: 'analyze' }).queued).toBe(0)
    h.lib.repos.jobs.enqueue({ type: 'ai.enrich', itemId: b.id, dedupeKey: `ai:${b.id}` })
    await run()
    expect(argvLines()).toHaveLength(0)
    expect(h.lib.repos.items.getById(b.id)!.ai_state).toBe('skipped')
  })
})

describe('errors, retries, fallback', () => {
  it('invalid JSON → reinforced 2nd try → done (2 calls logged)', async () => {
    modes.claude = 'bad_json'
    const it1 = await addImage()
    svc.enqueue({ itemUuids: [it1.uuid], task: 'analyze' })
    h.queue.start()
    await h.queue.whenIdle()
    clock.now += 5_000
    await run()
    expect(h.lib.repos.items.getById(it1.id)!.ai_state).toBe('done')
    expect(calls().map((c) => c.outcome)).toEqual(['error', 'ok'])
    expect(argvLines()[1]!.args.join(' ')).toContain("n'était pas un JSON valide")
  })

  it('OCR "429 Too Many Requests" / "authentication failed": done, no pause', async () => {
    modes.claude = 'ok_429'
    const it1 = await addImage()
    svc.enqueue({ itemUuids: [it1.uuid], task: 'analyze' })
    await run()
    expect(h.lib.repos.items.getById(it1.id)!.ai_state).toBe('done')
    expect(svc.gate.paused()).toEqual({})
  })

  it('forbidden tool → final TOOL_VIOLATION, not retried', async () => {
    modes.claude = 'tool_violation'
    const it1 = await addImage()
    svc.enqueue({ itemUuids: [it1.uuid], task: 'analyze' })
    await run()
    clock.now += 3_600_000
    await run()
    expect(h.lib.repos.items.getById(it1.id)!.ai_state).toBe('failed')
    expect(calls().map((c) => c.outcome)).toEqual(['violation'])
    const d = h.lib.repos.items.getById(it1.id)!
    expect(d.ai_description).toBeNull()
  })

  it('Claude limit → provider pause and IMMEDIATE switch to Codex', async () => {
    prefs = PrefsSchema.parse({ ...prefs, ai: { ...prefs.ai, fallback: 'codex' } })
    modes.claude = 'rate_limit'
    const a = await addImage()
    const b = await addImage()
    svc.enqueue({ itemUuids: [a.uuid, b.uuid], task: 'analyze' })
    await run()
    expect(svc.gate.paused().claude?.reason).toBe('RATE_LIMITED')
    for (const it of [a, b])
      expect(h.lib.repos.items.getById(it.id)).toMatchObject({
        ai_state: 'done',
        ai_provider: 'codex',
      })
    // A single Claude call: the following ones go straight to Codex.
    expect(calls().map((c) => `${c.provider}:${c.outcome}`)).toEqual([
      'claude:rate_limited',
      'codex:ok',
      'codex:ok',
    ])
    const snap = svc.snapshot()
    expect(snap.cli.providers.claude.paused?.reason).toBe('RATE_LIMITED')
    expect(snap.cli.providers.claude.paused?.until).toBeGreaterThan(clock.now)
    // Attempt not counted for the switched job.
    const attempts = h.lib.db
      .prepare("SELECT attempts FROM jobs WHERE type = 'ai.enrich'")
      .all() as { attempts: number }[]
    expect(attempts.every((r) => r.attempts === 1)).toBe(true)
  })

  it('without fallback: limit → job waits until the end of the pause, no attempt consumed', async () => {
    modes.claude = 'rate_limit_event'
    const a = await addImage()
    svc.enqueue({ itemUuids: [a.uuid], task: 'analyze' })
    await run()
    const job = h.lib.db
      .prepare("SELECT state, attempts, run_after FROM jobs WHERE type = 'ai.enrich'")
      .get() as {
      state: string
      attempts: number
      run_after: number
    }
    expect(job).toMatchObject({ state: 'queued', attempts: 0 })
    // resetsAt of the fake CLI already past at this clock → 15 min step.
    expect(job.run_after).toBe(clock.now + 15 * 60_000)
    expect(svc.gate.paused().claude).toMatchObject({ reason: 'RATE_LIMITED', strikes: 1 })
  })

  it('PROCESS twice on the main → fallback (two-failure rule), backoff written', async () => {
    prefs = PrefsSchema.parse({ ...prefs, ai: { ...prefs.ai, fallback: 'codex' } })
    modes.claude = 'crash'
    const a = await addImage()
    svc.enqueue({ itemUuids: [a.uuid], task: 'analyze' })
    await run()
    const j1 = h.lib.db
      .prepare("SELECT run_after, payload FROM jobs WHERE type = 'ai.enrich'")
      .get() as {
      run_after: number
      payload: string
    }
    expect(j1.run_after - clock.now).toBeGreaterThanOrEqual(30_000)
    expect(j1.run_after - clock.now).toBeLessThanOrEqual(36_000)
    expect((JSON.parse(j1.payload) as { failedOn: string[] }).failedOn).toEqual(['claude'])
    clock.now += 60_000
    await run()
    clock.now += 120_000
    await run()
    expect(h.lib.repos.items.getById(a.id)).toMatchObject({
      ai_state: 'done',
      ai_provider: 'codex',
    })
    expect(calls().map((c) => `${c.provider}:${c.outcome}`)).toEqual([
      'claude:error',
      'claude:error',
      'codex:ok',
    ])
  })

  it('resume after abrupt stop: the interrupted job goes back in the queue without an attempt', async () => {
    modes.claude = 'slow'
    const a = await addImage()
    svc.enqueue({ itemUuids: [a.uuid], task: 'analyze' })
    h.queue.start()
    await new Promise((r) => setTimeout(r, 600))
    await h.queue.stop()
    const j = h.lib.db.prepare("SELECT state, attempts FROM jobs WHERE type = 'ai.enrich'").get()
    expect(j).toMatchObject({ state: 'queued', attempts: 0 })
    modes.claude = 'ok'
    await run()
    expect(h.lib.repos.items.getById(a.id)!.ai_state).toBe('done')
  })
})

describe('budget (injected clock)', () => {
  it('hourly limit: 2/h in a batch → the 3rd waits for the window', async () => {
    prefs = PrefsSchema.parse({ ...prefs, ai: { ...prefs.ai, perHour: 2 } })
    const items = [await addImage(), await addImage(), await addImage()]
    const plan = svc.batchCreate('unanalyzed')
    expect(plan.estimate.count).toBe(3)
    svc.batchStart(plan.planId)
    await run()
    const states = items.map((i) => h.lib.repos.items.getById(i.id)!.ai_state)
    expect(states.filter((s) => s === 'done')).toHaveLength(2)
    const waiting = h.lib.db
      .prepare("SELECT run_after, attempts FROM jobs WHERE type = 'ai.enrich' AND state = 'queued'")
      .get() as { run_after: number; attempts: number }
    expect(waiting.attempts).toBe(0)
    expect(waiting.run_after).toBeGreaterThanOrEqual(clock.now + 3_600_000 - 1)
    clock.now += 3_600_001
    await run()
    expect(items.every((i) => h.lib.repos.items.getById(i.id)!.ai_state === 'done')).toBe(true)
    expect(svc.snapshot().batch).toBeUndefined()
  })

  it('hard cap: also applies to MANUAL; explicit exemption', async () => {
    prefs = PrefsSchema.parse({ ...prefs, ai: { ...prefs.ai, hardPerDay: 1 } })
    const a = await addImage()
    const b = await addImage()
    svc.enqueue({ itemUuids: [a.uuid], task: 'analyze' })
    await run()
    svc.enqueue({ itemUuids: [b.uuid], task: 'analyze' })
    await run()
    expect(h.lib.repos.items.getById(b.id)!.ai_state).toBe('queued')
    expect(svc.snapshot().cli.providers.claude.paused?.reason).toBe('HARD_CAP')
    svc.budgetOverride(clock.now + 3_600_000)
    h.lib.db.prepare("UPDATE jobs SET run_after = 0 WHERE state = 'queued'").run()
    await run()
    expect(h.lib.repos.items.getById(b.id)!.ai_state).toBe('done')
  })

  it('canStart: priorities, demotion, timeout counted, cancelled excluded', () => {
    const db = h.lib.db
    const now = clock.now
    const ins = db.prepare(
      "INSERT INTO ai_calls (ts, provider, task, sent_files, sent_text_chars, prompt_sha256, outcome, priority) VALUES (?, 'claude', 'analyze', '[]', 1, 'x', ?, ?)",
    )
    const p = { perHour: 3, perDay: 10, hardPerDay: 20, minGapMs: 0 }
    for (let i = 0; i < 5; i++) ins.run(now - 1_000 * (i + 1), 'ok', JOB_PRIORITY.INTERACTIVE)
    expect(canStart(db, 'claude', JOB_PRIORITY.INTERACTIVE, p, now)).toMatchObject({
      ok: false,
      demoteTo: JOB_PRIORITY.SYNC,
    })
    expect(canStart(db, 'claude', JOB_PRIORITY.MANUAL, p, now).ok).toBe(true)
    expect(canStart(db, 'claude', JOB_PRIORITY.BATCH, p, now)).toMatchObject({
      ok: false,
      reason: 'perHour',
    })
    ins.run(now - 100, 'cancelled', 20)
    ins.run(now - 100, 'timeout', 20)
    expect(
      canStart(db, 'claude', JOB_PRIORITY.BATCH, { ...p, perHour: 100, perDay: 6 }, now),
    ).toMatchObject({ ok: false, reason: 'perDay' })
    expect(
      canStart(
        db,
        'claude',
        JOB_PRIORITY.BATCH,
        { ...p, perHour: 100, perDay: 100, minGapMs: 5_000 },
        now,
      ),
    ).toMatchObject({ ok: false, reason: 'gap' })
  })
})

describe('batches, estimation, control, log, preview', () => {
  it('estimation: missing items outside trash and excluded, 0 job created before enqueue', async () => {
    await addImage()
    await addImage({ aiDescription: 'déjà décrit', aiLang: 'en' })
    await addImage({ deletedAt: 1 })
    await addImage({ aiExcluded: true })
    expect(svc.estimate({ missingDescription: true }).count).toBe(1)
    expect(svc.batchCreate('regenerate-fr').estimate.count).toBe(1)
    expect((h.lib.db.prepare('SELECT count(*) AS n FROM jobs').get() as { n: number }).n).toBe(0)
  })

  it('batch cancellation: queued jobs cancelled, written results kept', async () => {
    const a = await addImage()
    const b = await addImage()
    const plan = svc.batchCreate('unanalyzed')
    const { batchUuid } = svc.batchStart(plan.planId)
    // The first one passes, then we pause the queue and cancel.
    prefs = PrefsSchema.parse({ ...prefs, ai: { ...prefs.ai, perHour: 1 } })
    await run()
    svc.control({ action: 'cancel', batchUuid })
    const done = [a, b].filter((i) => h.lib.repos.items.getById(i.id)!.ai_state === 'done')
    const none = [a, b].filter((i) => h.lib.repos.items.getById(i.id)!.ai_state === 'none')
    expect(done).toHaveLength(1)
    expect(none).toHaveLength(1)
    expect(h.lib.db.prepare('SELECT state FROM ai_batches').get()).toEqual({ state: 'cancelled' })
  })

  it('pause / resume of the AI queue (user pause exposed)', async () => {
    const a = await addImage()
    h.queue.start()
    svc.control({ action: 'pause' })
    svc.enqueue({ itemUuids: [a.uuid], task: 'analyze' })
    await h.queue.whenIdle()
    expect(h.lib.repos.items.getById(a.id)!.ai_state).toBe('queued')
    expect(svc.snapshot().cli.providers.claude.paused?.reason).toBe('USER')
    svc.control({ action: 'resume' })
    await run()
    expect(h.lib.repos.items.getById(a.id)!.ai_state).toBe('done')
  })

  it('log: list and clear; preview = exact JPEGs and full prompt', async () => {
    const a = await addImage({ sourceUrl: 'https://example.com/page?token=SECRET' })
    svc.enqueue({ itemUuids: [a.uuid], task: 'analyze' })
    await run()
    const list = svc.callsList(10)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ itemUuid: a.uuid, provider: 'claude', outcome: 'ok' })
    const pv = await svc.previewPayload(a.uuid, 'analyze')
    expect(pv.files).toHaveLength(1)
    expect(pv.files[0]!.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(pv.prompt).toContain('Source')
    expect(pv.prompt).not.toContain('SECRET')
    expect(pv.system).toMatch(/^Tu es le moteur/)
    expect(svc.callsClear()).toBe(1)
    expect(svc.callsList(10)).toHaveLength(0)
  })

  it('level 2 connection test: synthetic image, call logged (task "test")', async () => {
    const r = await svc.test('claude', true)
    expect(r).toMatchObject({ ok: true, model: 'claude-haiku-5-5' })
    expect(calls()).toMatchObject([{ task: 'test', outcome: 'ok', item_id: null }])
    expect((await svc.test('claude', false)).ok).toBe(true)
    expect(calls()).toHaveLength(1)
  })

  it('image prompt on demand', async () => {
    const a = await addImage()
    svc.enqueue({ itemUuids: [a.uuid], task: 'imagePrompt' })
    await run()
    expect(h.lib.repos.items.getById(a.id)!.ai_prompt).toContain('A synthetic test image')
  })
})
