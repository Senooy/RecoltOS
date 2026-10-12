/**
 * Resolution of system binaries. For each tool:
 *   1) `prefs.tools.<bin>` if it is executable;
 *   2) `/opt/homebrew/bin/<bin>`, then `/usr/local/bin/<bin>`;
 *   3) the login shell (`login-shell-env.ts`).
 * `sips`: always `/usr/bin/sips`; `prefs.tools.sips` is ignored.
 * Missing ffmpeg/ffprobe = degraded mode (video jobs in `tool_missing`), never a crash.
 */
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { Prefs } from '../../shared/prefs'
import { readLoginShellEnv, type LoginShellEnv, type LoginShellTool } from './login-shell-env'

export interface BinPaths {
  ffmpeg?: string
  ffprobe?: string
  sips: string
  claude?: string
  codex?: string
}

export type BinName = keyof BinPaths
export const SIPS_PATH = '/usr/bin/sips'
export const SYSTEM_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'] as const
const LOOKUP: readonly LoginShellTool[] = ['ffmpeg', 'ffprobe', 'claude', 'codex']

export type IsExecutable = (p: string) => Promise<boolean>

/** Ordinary executable file (`X_OK`), absolute path only. */
export const isExecutable: IsExecutable = async (p) => {
  if (!p || !isAbsolute(p)) return false
  try {
    await access(p, constants.X_OK)
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

export interface ResolveDeps {
  isExecutable?: IsExecutable
  /** Called at most once, only if a tool is still missing after steps 1 and 2. */
  loginShell?: () => Promise<LoginShellEnv>
}

export async function resolveBinaries(
  prefs: Pick<Prefs, 'tools'> | { tools?: Partial<Record<BinName, string | undefined>> },
  deps: ResolveDeps = {},
): Promise<BinPaths> {
  const isExec = deps.isExecutable ?? isExecutable
  const tools = (prefs.tools ?? {}) as Partial<Record<BinName, string | undefined>>
  const out: BinPaths = { sips: SIPS_PATH }

  const missing: LoginShellTool[] = []
  for (const bin of LOOKUP) {
    const fromPrefs = tools[bin]
    if (fromPrefs && (await isExec(fromPrefs))) {
      out[bin] = fromPrefs
      continue
    }
    let found: string | undefined
    for (const dir of SYSTEM_DIRS) {
      const cand = `${dir}/${bin}`
      if (await isExec(cand)) {
        found = cand
        break
      }
    }
    if (found) out[bin] = found
    else missing.push(bin)
  }

  if (missing.length > 0) {
    const shell = await (deps.loginShell ?? (() => readLoginShellEnv()))().catch(
      (): LoginShellEnv => ({ path: null, tools: {} }),
    )
    for (const bin of missing) {
      const cand = shell.tools[bin]
      if (cand && (await isExec(cand))) out[bin] = cand
    }
  }
  return out
}

/** Paths to cache in `prefs.tools` (shown in Settings > AI / Storage). */
export function toolsPrefsPatch(bins: BinPaths): Partial<Record<BinName, string>> {
  const patch: Partial<Record<BinName, string>> = {}
  for (const k of ['ffmpeg', 'ffprobe', 'claude', 'codex'] as const) {
    const v = bins[k]
    if (v) patch[k] = v
  }
  return patch
}

/** Tools passed to the media-worker (`__configure`). */
export function mediaToolsOf(bins: BinPaths): { ffmpeg?: string; ffprobe?: string; sips: string } {
  const t: { ffmpeg?: string; ffprobe?: string; sips: string } = { sips: bins.sips }
  if (bins.ffmpeg) t.ffmpeg = bins.ffmpeg
  if (bins.ffprobe) t.ffprobe = bins.ffprobe
  return t
}

/** Video degraded mode: true if ffmpeg or ffprobe is missing (Settings > Storage). */
export function videoToolsMissing(bins: BinPaths): boolean {
  return !bins.ffmpeg || !bins.ffprobe
}
