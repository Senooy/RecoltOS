/**
 * Provider registry: one `CliRuntime` per CLI (binary resolved and cached, fixed cwd
 * `<userData>/ai-sandbox/<id>/` at 0700, without `.git`, `.claude/` or `.mcp.json`).
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AiCliId, AiInput } from '../../../shared/ai-types'
import type { Prefs } from '../../../shared/prefs'
import { loginShellPath, resolveCli, type DetectDeps, type ResolvedCli } from '../cli/resolve'
import type { runCli } from '../cli/spawn'
import type { CliProviderBase, CliRuntime } from './base'
import { ClaudeCliProvider } from './claude'
import { CodexCliProvider } from './codex'

export { NullProvider } from './none'

export interface ProvidersDeps {
  userData: string
  prefs(): Prefs
  makeTestInput?(jobDir: string): Promise<AiInput>
  detect?: DetectDeps
  loginPath?: () => Promise<string | null>
  run?: typeof runCli
}

export interface ProviderRegistry {
  get(id: AiCliId): CliProviderBase
  /** Forgets the resolved binaries (path change, "Check" action). */
  refresh(): void
  resolved(id: AiCliId): Promise<ResolvedCli | null>
  sandboxDir(id: AiCliId): string
}

export function sandboxDirOf(userData: string, id: AiCliId): string {
  return join(userData, 'ai-sandbox', id)
}

export function createProviders(deps: ProvidersDeps): ProviderRegistry {
  const cache = new Map<AiCliId, { key: string; p: Promise<ResolvedCli | null> }>()
  const resolved = (id: AiCliId): Promise<ResolvedCli | null> => {
    const prefs = deps.prefs()
    const key = `${prefs.ai[id].path ?? ''}|${prefs.tools[id] ?? ''}`
    const hit = cache.get(id)
    if (hit && hit.key === key) return hit.p
    const p = resolveCli(id, prefs, deps.detect ?? {}).catch(() => null)
    cache.set(id, { key, p })
    // A failure is not cached durably.
    void p.then((r) => {
      if (!r && cache.get(id)?.p === p) cache.delete(id)
    })
    return p
  }
  const runtime = (id: AiCliId): CliRuntime => {
    const sandboxDir = sandboxDirOf(deps.userData, id)
    mkdirSync(join(sandboxDir, 'jobs'), { recursive: true, mode: 0o700 })
    return {
      resolve: () => resolved(id),
      loginPath: deps.loginPath ?? (() => loginShellPath()),
      sandboxDir,
      prefs: () => deps.prefs().ai,
      ...(deps.makeTestInput ? { makeTestInput: (dir: string) => deps.makeTestInput!(dir) } : {}),
    }
  }
  const claude = new ClaudeCliProvider(runtime('claude'), deps.run)
  const codex = new CodexCliProvider(runtime('codex'), deps.run)
  return {
    get: (id) => (id === 'claude' ? claude : codex),
    refresh: () => cache.clear(),
    resolved,
    sandboxDir: (id) => sandboxDirOf(deps.userData, id),
  }
}
