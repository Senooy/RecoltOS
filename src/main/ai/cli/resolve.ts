/**
 * Détection des CLI IA (AI §3.4). Une app lancée depuis le Finder n'hérite pas du PATH du shell :
 * on interroge le shell de login (`/bin/zsh -lc 'whence -ap <nom>'`), on dédoublonne par chemin
 * réel, on lit `--version` (env minimal, 5 s) et on garde la version la plus haute. Surcharge
 * manuelle : `prefs.ai.<cli>.path`, puis `prefs.tools.<cli>` (cache de `platform/binaries.ts`).
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

/** PATH du shell de login (mis en cache pour la session de l'app). */
export function loginShellPath(): Promise<string | null> {
  loginPathCache ??= readLoginShellEnv().then((e) => e.path)
  return loginPathCache
}

export function resetLoginPathCache(): void {
  loginPathCache = null
}

/** Compare deux versions « a.b.c » (les parties manquantes valent 0). */
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
    // lien cassé : `--version` échouera
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
  /** Dossiers parcourus en plus du shell ; par défaut PATH interactif + dossiers courants (aucun sous Vitest). */
  searchDirs?: string[]
}

/**
 * Dossiers d'installation courants, consultés en plus du shell : `zsh -lc` ne lit pas `.zshrc`,
 * où beaucoup d'installeurs (npm global, Hermes, bun, volta) ajoutent leur dossier au PATH.
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

/** Toutes les copies trouvées par le shell de login, dédoublonnées, avec leur version. */
export async function detectCli(name: AiCliId, deps: DetectDeps = {}): Promise<CliCandidate[]> {
  const shell = deps.shell ?? defaultShell
  const isExec = deps.isExecutable ?? isExecutable
  const loginPath = await loginShellPath().catch(() => null)
  const version = deps.version ?? ((bin: string) => cliVersion(bin, loginPath))
  // Nom figé (pas d'entrée utilisateur) : aucune interpolation dangereuse.
  const out = await shell(
    `whence -ap ${name} 2>/dev/null; command -v ${name} 2>/dev/null`,
    5_000,
  ).catch(() => '')
  // PATH du shell de login interactif (`zsh -lic`, lit `.zshrc`) puis dossiers courants.
  // Sous Vitest, rien par défaut : un test ne doit jamais tomber sur le vrai CLI de la machine.
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

/** Choix du binaire : surcharge manuelle, cache `prefs.tools`, puis la plus haute version trouvée. */
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
