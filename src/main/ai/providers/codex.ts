/**
 * Codex provider: ALWAYS isolated, no fallback without isolation.
 * `codex exec --ephemeral --ignore-user-config --ignore-rules --skip-git-repo-check --sandbox read-only
 *  --color never -C <sandbox> [-m <model>] -c model_reasoning_effort="low" -c web_search="disabled"
 *  -c project_doc_max_bytes=0 <--disable F…> --output-schema <job>/schema.json -o <job>/out.json --json
 *  -i <img>… -- "<SYSTEM_FR>\n\n<PROMPT>"`, stdin CLOSED
 * (otherwise codex appends it to the prompt).
 * No separate `CODEX_HOME` (token renewal would log the user's own Codex out).
 */
import { realpathSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AiError, type AiCallOptions, type ProviderStatus } from '../../../shared/ai-types'
import { buildCliEnv } from '../cli/env'
import { codexDisableList, disableArgs } from '../cli/features'
import { runCli } from '../cli/spawn'
import { createCodexStreamGuard, parseTokensUsed } from '../cli/stream-guard'
import { classifyError } from '../errors'
import { decodeTolerant } from '../schemas'
import { CliProviderBase, type CliRuntime, type ExecOutput, type ExecSpec } from './base'
import { mt } from '../../i18n'

export interface CodexArgsInput {
  sandboxDir: string
  jobDir: string
  model?: string | undefined
  effort: 'low' | 'medium'
  disable: readonly string[]
  images: readonly string[]
  prompt: string
}

export function buildCodexArgs(a: CodexArgsInput): string[] {
  return [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--color',
    'never',
    '-C',
    a.sandboxDir,
    ...(a.model ? ['-m', a.model] : []),
    '-c',
    `model_reasoning_effort="${a.effort}"`,
    '-c',
    'web_search="disabled"',
    '-c',
    'project_doc_max_bytes=0',
    ...disableArgs(a.disable),
    '--output-schema',
    join(a.jobDir, 'schema.json'),
    '-o',
    join(a.jobDir, 'out.json'),
    '--json',
    ...a.images.flatMap((p) => ['-i', p]),
    '--',
    a.prompt,
  ]
}

export class CodexCliProvider extends CliProviderBase {
  readonly id = 'codex' as const
  private readonly run: typeof runCli

  constructor(rt: CliRuntime, run: typeof runCli = runCli) {
    super(rt)
    this.run = run
  }

  private async env(bin: string): Promise<NodeJS.ProcessEnv> {
    let real = bin
    try {
      real = realpathSync(bin)
    } catch {
      // broken link
    }
    // codex is a `#!/usr/bin/env node` script: the `node` next to the link must be in PATH.
    return buildCliEnv(await this.rt.loginPath(), [dirname(bin), dirname(real)])
  }

  private async simple(bin: string, args: string[]): Promise<string> {
    const r = await this.run({
      bin,
      args,
      cwd: this.rt.sandboxDir,
      env: await this.env(bin),
      timeoutMs: 10_000,
    })
    return `${r.stdout}\n${r.stderr}`
  }

  async status(): Promise<ProviderStatus> {
    const cli = await this.rt.resolve()
    if (!cli) return { installed: false, warnings: [] }
    const warnings: string[] = []
    const out = await this.simple(cli.path, ['login', 'status']).catch(() => '')
    const chatgpt = /Logged in using ChatGPT/i.test(out)
    const apiKey = /API key/i.test(out)
    if (apiKey) warnings.push(mt().ai.apiKey)
    const loggedIn = chatgpt || apiKey
    return {
      installed: true,
      path: cli.path,
      ...(cli.version ? { version: cli.version } : {}),
      candidates: cli.candidates.map((c) => ({
        path: c.path,
        ...(c.version ? { version: c.version } : {}),
      })),
      loggedIn,
      authKind: chatgpt ? 'subscription' : apiKey ? 'api_key' : 'unknown',
      ...(chatgpt ? { plan: 'ChatGPT' } : {}),
      warnings,
    }
  }

  protected async exec(spec: ExecSpec, o: AiCallOptions): Promise<ExecOutput> {
    const cli = await this.rt.resolve()
    if (!cli) throw new AiError('NOT_INSTALLED', 'codex introuvable')
    const prefs = this.rt.prefs()
    const disable = await codexDisableList(cli.version, () =>
      this.simple(cli.path, ['features', 'list']),
    )
    await writeFile(join(spec.jobDir, 'schema.json'), JSON.stringify(spec.schema), { mode: 0o600 })
    const model = o.model ?? prefs.codex.model
    const args = buildCodexArgs({
      sandboxDir: this.rt.sandboxDir,
      jobDir: spec.jobDir,
      model,
      effort: o.effort ?? prefs.codex.effort,
      disable,
      images: spec.input.media.map((m) => m.path),
      prompt: `${spec.system}\n\n${spec.prompt}`,
    })
    const guard = createCodexStreamGuard()
    const r = await this.run({
      bin: cli.path,
      args,
      cwd: this.rt.sandboxDir,
      env: await this.env(cli.path),
      timeoutMs: o.timeoutMs,
      signal: o.signal,
      onLine: (l, s) => guard.onLine(l, s),
    })
    if (r.spawnError)
      throw classifyError('spawn', r.spawnError.message, { code: r.spawnError.code ?? '' })
    if (guard.error) throw guard.error
    if (r.aborted) throw new AiError('CANCELLED', 'annulé')
    if (r.timedOut) throw new AiError('TIMEOUT', 'délai dépassé', { retryable: true })
    let text: string | null = null
    try {
      text = await readFile(join(spec.jobDir, 'out.json'), 'utf8')
    } catch {
      text = guard.lastMessage
    }
    if (text === null || text.trim() === '') {
      if (r.code !== 0) throw classifyError('exit', r.stderr)
      throw new AiError('BAD_OUTPUT', 'aucun résultat', { retryable: true })
    }
    const tokens = guard.usage.input ?? parseTokensUsed(r.stderr)
    const used = guard.model ?? model
    return {
      json: decodeTolerant(text) ?? text,
      ...(used ? { model: used } : {}),
      ...(tokens !== undefined ? { inputTokens: tokens } : {}),
      ...(guard.usage.output !== undefined ? { outputTokens: guard.usage.output } : {}),
    }
  }
}
