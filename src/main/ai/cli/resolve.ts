/**
 * AI CLI detection. An app launched from Finder does not inherit the shell PATH:
 * we query the login shell (`/bin/zsh -lc 'whence -ap <nom>'`), dedupe by real path,
 * read `--version` (minimal env, 5 s) and keep the highest version. Manual override:
 * `prefs.ai.<cli>.path`, then `prefs.tools.<cli>` (cache of `platform/binaries.ts`).
 */
import { realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AiCliId } from '../../../shared/ai-types'
import type { Prefs } from '../../../shared/prefs'
import { isExecutable } from '../../platform/binaries'
import { readLoginShellEnv } from '../../platform/login-shell-env'
import { buildCliEnv } from './env'
import { runCli } from './spawn'

export interface CliCandidate {
  name: AiCliId
  path: string
  realPath: string
  version?: string
}

export type ShellRunner = (script: string, timeoutMs: number) => Promise<string>

const defaultShell: ShellRunner = async (script, timeoutMs) => {
  const r = await runCli({
    bin: '/bin/zsh',
    args: ['-lc', script],
    cwd: '/',
    env: { HOME: process.env.HOME ?? '', USER: process.env.USER ?? '', TERM: 'dumb' },
    timeoutMs,
  })
  return r.stdout
}

let loginPathCache: Promise<string | null> | null = null

/** Login shell PATH (cached for the app session). */
export function loginShellPath(): Promise<string | null> {
  loginPathCache ??= readLoginShellEnv().then((e) => e.path)
  return loginPathCache
}

export function resetLoginPathCache(): void {
  loginPathCache = null
}

/** Compares two "a.b.c" versions (missing parts count as 0). */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

export function parseVersion(out: string): string | undefined {
  return /(\d+\.\d+\.\d+)/.exec(out)?.[1]
}

export async function cliVersion(
  bin: string,
  loginPath: string | null,
): Promise<string | undefined> {
  let real = bin
  try {
    real = realpathSync(bin)
  } catch {
    // broken link: `--version` will fail
  }
  const r = await runCli({
    bin,
    args: ['--version'],
    cwd: '/',
    env: buildCliEnv(loginPath, [dirname(bin), dirname(real)]),
    timeoutMs: 5_000,
  })
  if (r.spawnError || r.code !== 0) return undefined
  return parseVersion(r.stdout) ?? parseVersion(r.stderr)
}

export interface DetectDeps {
  shell?: ShellRunner
  version?: (bin: string) => Promise<string | undefined>
  isExecutable?: (p: string) => Promise<boolean>
  /** Directories scanned in addition to the shell; by default interactive PATH + common directories (none under Vitest). */
  searchDirs?: string[]
}

/**
 * Common install directories, checked in addition to the shell: `zsh -lc` does not read `.zshrc`,
 * where many installers (npm global, Hermes, bun, volta) add their directory to PATH.
 */
export function fallbackDirs(home: string): string[] {
  return [
    `${home}/.local/bin`,
    `${home}/.hermes/node/bin`,
    `${home}/.claude/local`,
    `${home}/.npm-global/bin`,
    `${home}/.bun/bin`,
    `${home}/.volta/bin`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
}

/** All copies found by the login shell, deduplicated, with their version. */
export async function detectCli(name: AiCliId, deps: DetectDeps = {}): Promise<CliCandidate[]> {
  const shell = deps.shell ?? defaultShell
  const isExec = deps.isExecutable ?? isExecutable
  const loginPath = await loginShellPath().catch(() => null)
  const version = deps.version ?? ((bin: string) => cliVersion(bin, loginPath))
  // Fixed name (no user input): no dangerous interpolation.
  const out = await shell(
    `whence -ap ${name} 2>/dev/null; command -v ${name} 2>/dev/null`,
    5_000,
  ).catch(() => '')
  // Interactive login shell PATH (`zsh -lic`, reads `.zshrc`), then common directories.
  // Under Vitest, nothing by default: a test must never hit the machine's real CLI.
  const dirs =
    deps.searchDirs ??
    (process.env.VITEST
      ? []
      : [
          ...(loginPath ?? '').split(':').filter((d) => d.startsWith('/')),
          ...fallbackDirs(process.env.HOME ?? ''),
        ])
  const lines = [...out.split(/\r?\n/), ...dirs.map((d) => `${d}/${name}`)]
  const seen = new Set<string>()
  const found: CliCandidate[] = []
  for (const line of lines) {
    const p = line.trim()
    if (!p.startsWith('/') || !(await isExec(p))) continue
    let realPath = p
    try {
      realPath = realpathSync(p)
    } catch {
      continue
    }
    if (seen.has(realPath)) continue
    seen.add(realPath)
    const v = await version(p).catch(() => undefined)
    found.push({ name, path: p, realPath, ...(v ? { version: v } : {}) })
  }
  return found.sort((a, b) => compareSemver(b.version ?? '0', a.version ?? '0'))
}

export interface ResolvedCli {
  path: string
  realPath: string
  version?: string
  candidates: CliCandidate[]
  source: 'prefs' | 'tools' | 'login-shell'
}

/** Binary choice: manual override, `prefs.tools` cache, then the highest version found. */
export async function resolveCli(
  name: AiCliId,
  prefs: Pick<Prefs, 'ai' | 'tools'>,
  deps: DetectDeps = {},
): Promise<ResolvedCli | null> {
  const isExec = deps.isExecutable ?? isExecutable
  const loginPath = await loginShellPath().catch(() => null)
  const version = deps.version ?? ((bin: string) => cliVersion(bin, loginPath))
  const fixed: [string | undefined, ResolvedCli['source']][] = [
    [prefs.ai[name].path, 'prefs'],
    [prefs.tools[name], 'tools'],
  ]
  for (const [p, source] of fixed) {
    if (!p || !(await isExec(p))) continue
    let realPath = p
    try {
      realPath = realpathSync(p)
    } catch {
      continue
    }
    const v = await version(p).catch(() => undefined)
    const cand: CliCandidate = { name, path: p, realPath, ...(v ? { version: v } : {}) }
    return { ...cand, candidates: [cand], source }
  }
  const candidates = await detectCli(name, deps)
  const best = candidates[0]
  if (!best) return null
  return { ...best, candidates, source: 'login-shell' }
}
