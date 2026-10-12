/**
 * Fournisseur Claude : `claude --safe-mode -p … --output-format stream-json --verbose
 * --json-schema … --system-prompt … --tools Read --allowedTools Read --permission-mode dontAsk
 * --permission-prompts none --strict-mcp-config --disable-slash-commands --no-session-persistence
 * --restricted --model … --effort …`, cwd FIXE `<userData>/ai-sandbox/claude/`.
 * JAMAIS `--bare` (il ne lit pas l'abonnement). Résultat : `structured_output` de la ligne `result`.
 */
import { realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import { AiError, type AiCallOptions, type ProviderStatus } from '../../../shared/ai-types'
import { buildCliEnv } from '../cli/env'
import { compareSemver } from '../cli/resolve'
import { runCli, type RunCliResult } from '../cli/spawn'
import { createClaudeStreamGuard } from '../cli/stream-guard'
import { classifyError } from '../errors'
import { CliProviderBase, type CliRuntime, type ExecOutput, type ExecSpec } from './base'

export const CLAUDE_MIN_VERSION = '2.1.259'
export const CLAUDE_FLAGS = [
  'safe-mode',
  'json-schema',
  'no-session-persistence',
  'permission-prompts',
  'effort',
  'tools',
  'restricted',
  'strict-mcp-config',
  'disable-slash-commands',
] as const
export type ClaudeFlag = (typeof CLAUDE_FLAGS)[number]

export function parseClaudeHelp(help: string): Set<ClaudeFlag> {
  const out = new Set<ClaudeFlag>()
  for (const f of CLAUDE_FLAGS) if (new RegExp(`--${f}\\b`).test(help)) out.add(f)
  return out
}

export interface ClaudeArgsInput {
  prompt: string
  system: string
  schema: Record<string, unknown>
  model?: string | undefined
  effort: 'low' | 'medium'
  outputMode: 'stream-json' | 'json'
  flags: ReadonlySet<ClaudeFlag>
}

export function buildClaudeArgs(a: ClaudeArgsInput): string[] {
  const has = (f: ClaudeFlag) => a.flags.has(f)
  const args: string[] = []
  if (has('safe-mode')) args.push('--safe-mode')
  args.push('-p', a.prompt)
  if (a.outputMode === 'stream-json') args.push('--output-format', 'stream-json', '--verbose')
  else args.push('--output-format', 'json')
  args.push('--json-schema', JSON.stringify(a.schema))
  args.push('--system-prompt', a.system)
  args.push('--tools', 'Read', '--allowedTools', 'Read')
  args.push('--permission-mode', 'dontAsk')
  if (has('permission-prompts')) args.push('--permission-prompts', 'none')
  args.push('--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence')
  if (has('restricted')) args.push('--restricted')
  if (a.model && a.model !== 'auto') args.push('--model', a.model)
  if (has('effort')) args.push('--effort', a.effort)
  if (args.includes('--bare')) throw new AiError('UNSUPPORTED_CLI', '--bare interdit')
  return args
}

const helpCache = new Map<string, Set<ClaudeFlag>>()

type Json = Record<string, unknown>

export class ClaudeCliProvider extends CliProviderBase {
  readonly id = 'claude' as const
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
      // lien cassé : le lancement échouera proprement
    }
    return buildCliEnv(await this.rt.loginPath(), [dirname(bin), dirname(real)])
  }

  async flags(bin: string, version: string | undefined): Promise<Set<ClaudeFlag>> {
    const key = `${bin}@${version ?? '?'}`
    const hit = helpCache.get(key)
    if (hit) return hit
    const r = await this.run({
      bin,
      args: ['--help'],
      cwd: this.rt.sandboxDir,
      env: await this.env(bin),
      timeoutMs: 10_000,
    })
    const flags = parseClaudeHelp(r.stdout + r.stderr)
    if (flags.size > 0) helpCache.set(key, flags)
    return flags
  }

  async status(): Promise<ProviderStatus> {
    const cli = await this.rt.resolve()
    if (!cli) return { installed: false, warnings: [] }
    const warnings: string[] = []
    const base: ProviderStatus = {
      installed: true,
      path: cli.path,
      ...(cli.version ? { version: cli.version } : {}),
      candidates: cli.candidates.map((c) => ({
        path: c.path,
        ...(c.version ? { version: c.version } : {}),
      })),
      warnings,
    }
    if (cli.version && compareSemver(cli.version, CLAUDE_MIN_VERSION) < 0)
      warnings.push(
        `Version ${cli.version} trop ancienne : mets à jour claude (≥ ${CLAUDE_MIN_VERSION}).`,
      )
    const flags = await this.flags(cli.path, cli.version).catch(() => new Set<ClaudeFlag>())
    if (!flags.has('safe-mode'))
      warnings.push('Version ancienne : --safe-mode indisponible, mets à jour claude.')
    const r = await this.run({
      bin: cli.path,
      args: ['auth', 'status'],
      cwd: this.rt.sandboxDir,
      env: await this.env(cli.path),
      timeoutMs: 10_000,
    })
    let auth: Json = {}
    try {
      auth = JSON.parse(r.stdout.trim()) as Json
    } catch {
      return { ...base, loggedIn: false, authKind: 'unknown' }
    }
    // Champs d'identité (e-mail, organisation) jamais lus ni renvoyés.
    const loggedIn = auth.loggedIn === true
    const sub = auth.authMethod === 'claude.ai' && auth.apiProvider === 'firstParty'
    if (loggedIn && !sub)
      warnings.push('Clé API détectée : facturation à l’usage, contraire à ton choix d’abonnement.')
    return {
      ...base,
      loggedIn,
      authKind: loggedIn ? (sub ? 'subscription' : 'api_key') : 'unknown',
      ...(typeof auth.subscriptionType === 'string' ? { plan: auth.subscriptionType } : {}),
    }
  }

  protected async exec(spec: ExecSpec, o: AiCallOptions): Promise<ExecOutput> {
    const cli = await this.rt.resolve()
    if (!cli) throw new AiError('NOT_INSTALLED', 'claude introuvable')
    if (cli.version && compareSemver(cli.version, CLAUDE_MIN_VERSION) < 0)
      throw new AiError('UNSUPPORTED_CLI', `claude ${cli.version} trop ancien`)
    const prefs = this.rt.prefs()
    const flags = await this.flags(cli.path, cli.version)
    const model = o.model ?? prefs.claude.model
    const args = buildClaudeArgs({
      prompt: spec.prompt,
      system: spec.system,
      schema: spec.schema,
      model,
      effort: o.effort ?? prefs.claude.effort,
      outputMode: prefs.claude.outputMode,
      flags,
    })
    const guard = createClaudeStreamGuard({ jobDir: spec.jobDir })
    const streaming = prefs.claude.outputMode === 'stream-json'
    const r = await this.run({
      bin: cli.path,
      args,
      cwd: this.rt.sandboxDir,
      env: await this.env(cli.path),
      timeoutMs: o.timeoutMs,
      signal: o.signal,
      ...(streaming ? { onLine: (l: string, s: 'stdout' | 'stderr') => guard.onLine(l, s) } : {}),
    })
    return this.read(r, guard, streaming, model)
  }

  private read(
    r: RunCliResult,
    guard: ReturnType<typeof createClaudeStreamGuard>,
    streaming: boolean,
    model: string | undefined,
  ): ExecOutput {
    if (r.spawnError)
      throw classifyError('spawn', r.spawnError.message, { code: r.spawnError.code ?? '' })
    if (guard.error) throw guard.error
    if (r.aborted) throw new AiError('CANCELLED', 'annulé')
    if (r.timedOut) throw new AiError('TIMEOUT', 'délai dépassé', { retryable: true })
    let result = guard.result
    if (!streaming) {
      try {
        result = JSON.parse(r.stdout.trim()) as Json
      } catch {
        result = null
      }
    }
    if (!result) {
      if (r.code !== 0) throw classifyError('exit', r.stderr)
      throw new AiError('BAD_OUTPUT', 'aucun résultat', { retryable: true })
    }
    const denials = result.permission_denials
    if (Array.isArray(denials) && denials.length > 0)
      throw new AiError('PROCESS', 'lecture refusée, essayer --add-dir', { retryable: false })
    if (result.is_error === true) {
      const text =
        typeof result.result === 'string'
          ? result.result
          : typeof result.subtype === 'string'
            ? result.subtype
            : 'erreur'
      throw classifyError('claude-result', text)
    }
    const usage = (result.usage ?? {}) as {
      input_tokens?: unknown
      output_tokens?: unknown
      cache_creation_input_tokens?: unknown
      cache_read_input_tokens?: unknown
    }
    const num = (v: unknown) => (typeof v === 'number' ? v : 0)
    const modelUsage =
      result.modelUsage && typeof result.modelUsage === 'object'
        ? Object.keys(result.modelUsage)
        : []
    const json =
      result.structured_output ?? (typeof result.result === 'string' ? result.result : null)
    const used = modelUsage[0] ?? guard.model ?? model
    return {
      json,
      ...(used ? { model: used } : {}),
      ...(typeof result.total_cost_usd === 'number' ? { costUsd: result.total_cost_usd } : {}),
      inputTokens:
        num(usage.input_tokens) +
        num(usage.cache_creation_input_tokens) +
        num(usage.cache_read_input_tokens),
      outputTokens: num(usage.output_tokens),
    }
  }
}
