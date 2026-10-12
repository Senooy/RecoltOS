import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AiError, type AiInput } from '../../../src/shared/ai-types'
import { PrefsSchema, type Prefs } from '../../../src/shared/prefs'
import { buildCliEnv, FORBIDDEN_ENV } from '../../../src/main/ai/cli/env'
import { parseFeaturesList } from '../../../src/main/ai/cli/features'
import { runCli, type RunCliOptions } from '../../../src/main/ai/cli/spawn'
import { classifyError, parseResetAt } from '../../../src/main/ai/errors'
import { createProviders } from '../../../src/main/ai/providers'
import { buildClaudeArgs, parseClaudeHelp } from '../../../src/main/ai/providers/claude'
import { REPO_ROOT } from '../../helpers'

const FAKE_CLAUDE = join(REPO_ROOT, 'tests/helpers/fake-bin/claude')
const FAKE_CODEX = join(REPO_ROOT, 'tests/helpers/fake-bin/codex')

let ud: string
let log: string
let mode = 'ok'
const envs: NodeJS.ProcessEnv[] = []
const runs: RunCliOptions[] = []

function prefs(over: Partial<Prefs['ai']> = {}): Prefs {
  return PrefsSchema.parse({
    ai: {
      provider: 'claude',
      claude: { path: FAKE_CLAUDE, model: 'claude-haiku-5-5' },
      codex: { path: FAKE_CODEX },
      ...over,
    },
  })
}

let current = prefs()
const registry = () =>
  createProviders({
    userData: ud,
    prefs: () => current,
    detect: { shell: () => Promise.resolve('') },
    loginPath: () => Promise.resolve(process.env.PATH ?? null),
    run: (o) => {
      envs.push(o.env)
      runs.push(o)
      return runCli({ ...o, env: { ...o.env, FAKE_CLI_MODE: mode, FAKE_CLI_LOG: log } })
    },
  })

async function input(dir: string, kind: AiInput['kind'] = 'image'): Promise<AiInput> {
  mkdirSync(dir, { recursive: true })
  const p = join(dir, 'img1.jpg')
  const info = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#123456' },
  })
    .jpeg()
    .toFile(p)
  return {
    itemUuid: 'u1',
    kind,
    media:
      kind === 'tweet'
        ? []
        : [{ path: p, mime: 'image/jpeg', bytes: info.size, width: 64, height: 64 }],
    context: {
      sourceLabel: 'Instagram',
      post: { authorName: 'A', authorHandle: '@a', caption: 'légende' },
    },
    vocabulary: ['affiche'],
  }
}

const opts = (jobDir: string, timeoutMs = 20_000) => ({
  signal: new AbortController().signal,
  timeoutMs,
  jobDir,
})

beforeAll(() => {
  ud = mkdtempSync(join(tmpdir(), 'recolt-ai-prov-'))
  log = join(ud, 'argv.log')
  process.env.ANTHROPIC_API_KEY = 'sk-test-ne-doit-pas-fuir'
})
afterAll(() => {
  delete process.env.ANTHROPIC_API_KEY
  rmSync(ud, { recursive: true, force: true })
})

const lastArgv = (): { bin: string; args: string[] } => {
  const lines = readFileSync(log, 'utf8').trim().split('\n')
  return JSON.parse(lines[lines.length - 1]!) as { bin: string; args: string[] }
}

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(AiError)
  expect((err as AiError).code).toBe(code)
  return err as AiError
}

describe('claude (fake CLI)', () => {
  it('success: value, meta, exact argv, minimal env', async () => {
    mode = 'ok'
    const reg = registry()
    const jobDir = join(reg.sandboxDir('claude'), 'jobs', '1')
    const r = await reg.get('claude').analyze(await input(jobDir), opts(jobDir))
    expect(r.value.title).toBe('Titre synthétique')
    expect(r.meta).toMatchObject({
      provider: 'claude',
      model: 'claude-haiku-5-5',
      sentTextChars: expect.any(Number) as number,
    })
    expect(r.meta.promptSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(r.meta.sentFiles).toEqual([
      { name: 'img1.jpg', bytes: expect.any(Number) as number, width: 64, height: 64 },
    ])
    const argv = lastArgv().args
    expect(argv).not.toContain('--bare')
    const flags = parseClaudeHelp(
      '--safe-mode --json-schema --no-session-persistence --permission-prompts --effort --tools --restricted --strict-mcp-config --disable-slash-commands',
    )
    const pi = argv.indexOf('-p')
    const si = argv.indexOf('--json-schema')
    expect(argv).toEqual(
      buildClaudeArgs({
        prompt: argv[pi + 1]!,
        system: argv[argv.indexOf('--system-prompt') + 1]!,
        schema: JSON.parse(argv[si + 1]!) as Record<string, unknown>,
        model: 'claude-haiku-5-5',
        effort: 'low',
        outputMode: 'stream-json',
        flags,
      }),
    )
    expect(argv.slice(0, 2)).toEqual(['--safe-mode', '-p'])
    expect(argv).toContain('--restricted')
    const run = runs[runs.length - 1]!
    expect(run.cwd).toBe(reg.sandboxDir('claude'))
    for (const k of FORBIDDEN_ENV) expect(run.env[k]).toBeUndefined()
    expect(run.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1')
  })

  it('OCR containing "429 Too Many Requests" and "authentication failed": success', async () => {
    mode = 'ok_429'
    const reg = registry()
    const jobDir = join(reg.sandboxDir('claude'), 'jobs', '2')
    const r = await reg.get('claude').analyze(await input(jobDir), opts(jobDir))
    expect(r.value.ocr).toContain('429 Too Many Requests')
  })

  it('invalid JSON → BAD_OUTPUT; 2nd attempt, reinforced → success', async () => {
    mode = 'bad_json'
    const reg = registry()
    const jobDir = join(reg.sandboxDir('claude'), 'jobs', '3')
    const i = await input(jobDir)
    await expectCode(reg.get('claude').analyze(i, opts(jobDir)), 'BAD_OUTPUT')
    const r = await reg.get('claude').analyze(i, { ...opts(jobDir), retry: true })
    expect(r.value.title).toBe('Titre synthétique')
  })

  it.each([
    ['rate_limit', 'RATE_LIMITED'],
    ['rate_limit_event', 'RATE_LIMITED'],
    ['not_logged', 'NOT_AUTHENTICATED'],
    ['tool_violation', 'TOOL_VIOLATION'],
    ['tool_violation_init', 'TOOL_VIOLATION'],
    ['mcp', 'TOOL_VIOLATION'],
    ['is_error_limit', 'RATE_LIMITED'],
    ['crash', 'PROCESS'],
  ])('mode %s → %s (without waiting for the delay)', async (m, code) => {
    mode = m
    const reg = registry()
    const jobDir = join(reg.sandboxDir('claude'), 'jobs', `e-${m}`)
    const t0 = Date.now()
    const e = await expectCode(reg.get('claude').analyze(await input(jobDir), opts(jobDir)), code)
    expect(Date.now() - t0).toBeLessThan(8_000)
    if (m === 'is_error_limit' || m === 'rate_limit_event')
      expect(e.opts?.resetAt).toBe(1791800000000)
  })

  it('timeout exceeded → TIMEOUT (group killed)', async () => {
    mode = 'slow'
    const reg = registry()
    const jobDir = join(reg.sandboxDir('claude'), 'jobs', 'slow')
    await expectCode(reg.get('claude').analyze(await input(jobDir), opts(jobDir, 400)), 'TIMEOUT')
  })

  it('binary missing → NOT_INSTALLED', async () => {
    current = prefs({
      claude: {
        path: join(ud, 'absent'),
        model: 'sonnet',
        effort: 'low',
        imageMode: 'read-tool',
        outputMode: 'stream-json',
        restricted: false,
      },
    })
    try {
      const reg = registry()
      const jobDir = join(reg.sandboxDir('claude'), 'jobs', 'ni')
      await expectCode(
        reg.get('claude').analyze(await input(jobDir), opts(jobDir)),
        'NOT_INSTALLED',
      )
      expect((await reg.get('claude').status()).installed).toBe(false)
    } finally {
      current = prefs()
    }
  })

  it('status: subscription, plan, never email nor organization; API key → warning', async () => {
    mode = 'ok'
    const s = await registry().get('claude').status()
    expect(s).toMatchObject({
      installed: true,
      loggedIn: true,
      authKind: 'subscription',
      plan: 'max',
      version: '2.1.284',
    })
    expect(JSON.stringify(s)).not.toMatch(/secret|org-/i)
    mode = 'api_key'
    const k = await registry().get('claude').status()
    expect(k.authKind).toBe('api_key')
    expect(k.warnings.join(' ')).toMatch(/Clé API/)
  })
})

describe('codex (fake CLI)', () => {
  it('isolated success: stdin closed, `--` then prompt, --disable computed', async () => {
    mode = 'ok'
    const reg = registry()
    const jobDir = join(reg.sandboxDir('codex'), 'jobs', '1')
    const r = await reg.get('codex').analyze(await input(jobDir), opts(jobDir))
    expect(r.value.title).toBe('Titre Codex')
    expect(r.meta.inputTokens).toBe(3200)
    const argv = lastArgv().args
    const disabled = argv.filter((_, i) => argv[i - 1] === '--disable')
    expect(disabled.sort()).toEqual(
      [
        'apps',
        'browser_use',
        'hooks',
        'image_generation',
        'multi_agent',
        'shell_tool',
        'unified_exec',
        'view_image',
      ].sort(),
    )
    expect(argv[argv.length - 2]).toBe('--')
    expect(argv[argv.length - 1]).toMatch(/^Tu es le moteur d'indexation/)
    expect(argv).toContain('-i')
  })

  it.each([
    ['tool_violation', 'TOOL_VIOLATION'],
    ['rate_limit', 'RATE_LIMITED'],
    ['not_logged', 'NOT_AUTHENTICATED'],
    ['turn_failed', 'PROCESS'],
    ['crash', 'PROCESS'],
  ])('mode %s → %s', async (m, code) => {
    mode = m
    const reg = registry()
    const jobDir = join(reg.sandboxDir('codex'), 'jobs', `e-${m}`)
    await expectCode(reg.get('codex').analyze(await input(jobDir), opts(jobDir)), code)
  })

  it('login status: ChatGPT; API key → warning', async () => {
    mode = 'ok'
    expect(await registry().get('codex').status()).toMatchObject({
      loggedIn: true,
      plan: 'ChatGPT',
      authKind: 'subscription',
    })
    mode = 'api_key'
    const s = await registry().get('codex').status()
    expect(s.authKind).toBe('api_key')
    expect(s.warnings[0]).toMatch(/Clé API/)
  })
})

describe('classification and tools', () => {
  it('only on error channels', () => {
    expect(classifyError('claude-retry', 'rate_limit').code).toBe('RATE_LIMITED')
    expect(classifyError('claude-retry', 'authentication_failed').code).toBe('NOT_AUTHENTICATED')
    expect(classifyError('claude-result', 'Please run /login').code).toBe('NOT_AUTHENTICATED')
    expect(classifyError('codex-event', 'usage limit reached').code).toBe('RATE_LIMITED')
    expect(classifyError('exit', 'rate limit 429 dans stderr').code).toBe('PROCESS')
    expect(classifyError('spawn', 'x', { code: 'ENOENT' }).code).toBe('NOT_INSTALLED')
    expect(parseResetAt('limit reached|1791800000')).toBe(1791800000000)
  })

  it('features list: only stable active ones', () => {
    expect(
      parseFeaturesList(
        'shell_tool   stable  true\napply_patch_freeform removed false\nmemories stable false\nhooks experimental true\nfoo stable true',
      ),
    ).toEqual(['shell_tool', 'hooks'])
  })

  it('buildCliEnv: never process.env', () => {
    const env = buildCliEnv('/a:/b:/a', ['/bin-dir'])
    expect(Object.keys(env).sort()).toEqual(
      [
        'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
        'DISABLE_AUTOUPDATER',
        'HOME',
        'LANG',
        'LOGNAME',
        'NO_COLOR',
        'PATH',
        'SHELL',
        'TMPDIR',
        'USER',
      ].sort(),
    )
    expect(env.PATH!.split(':').slice(0, 3)).toEqual(['/bin-dir', '/a', '/b'])
  })

  it('runCli: stdin closed, safeguard that kills the group', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'recolt-run-'))
    const script = join(dir, 's.sh')
    writeFileSync(script, '#!/bin/sh\necho un\necho deux\nsleep 30\n', { mode: 0o755 })
    const t0 = Date.now()
    const r = await runCli({
      bin: script,
      args: [],
      cwd: dir,
      env: { PATH: '/bin:/usr/bin' },
      timeoutMs: 20_000,
      onLine: (l) => (l === 'deux' ? 'kill' : undefined),
    })
    expect(r.killedByGuard).toBe(true)
    expect(Date.now() - t0).toBeLessThan(5_000)
    rmSync(dir, { recursive: true, force: true })
  })
})
