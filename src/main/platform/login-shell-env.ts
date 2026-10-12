/**
 * Login shell environment: an app launched from the Finder inherits a minimal `PATH` and sees
 * neither `claude`, `codex`, nor `/opt/homebrew/bin/ffmpeg`.
 * We query `zsh -lic` (5 s timeout); each tool is printed on a tagged line to withstand stray
 * output from `.zshrc` (prompts, extensions) and missing tools.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { isAbsolute } from 'node:path'

export const LOGIN_SHELL_TOOLS = ['claude', 'codex', 'ffmpeg', 'ffprobe'] as const
export type LoginShellTool = (typeof LOGIN_SHELL_TOOLS)[number]

export interface LoginShellEnv {
  /** `PATH` of the login shell, or `null` if not found. */
  path: string | null
  /** Absolute paths found by `command -v`. */
  tools: Partial<Record<LoginShellTool, string>>
}

export const LOGIN_SHELL_TIMEOUT_MS = 5_000
const MARK = '__RECOLT__'

export function loginShellScript(tools: readonly string[] = LOGIN_SHELL_TOOLS): string {
  const lines = [`printf '${MARK}PATH=%s\\n' "$PATH"`]
  for (const t of tools) {
    // Fixed names (no user input): no dangerous interpolation.
    lines.push(`printf '${MARK}${t}=%s\\n' "$(command -v ${t} 2>/dev/null)"`)
  }
  return lines.join('; ')
}

/** Parses the tagged output; ignores everything else (exported for tests). */
export function parseLoginShellOutput(out: string): LoginShellEnv {
  const env: LoginShellEnv = { path: null, tools: {} }
  for (const raw of out.split(/\r?\n/)) {
    const i = raw.indexOf(MARK)
    if (i < 0) continue
    const rest = raw.slice(i + MARK.length)
    const eq = rest.indexOf('=')
    if (eq <= 0) continue
    const key = rest.slice(0, eq)
    const value = rest.slice(eq + 1).trim()
    if (key === 'PATH') {
      if (value) env.path = value
    } else if ((LOGIN_SHELL_TOOLS as readonly string[]).includes(key)) {
      // `command -v` returns a bare name for an alias or function: only absolute paths count.
      if (value && isAbsolute(value) && !value.includes('\n')) {
        env.tools[key as LoginShellTool] = value
      }
    }
  }
  return env
}

export type SpawnShell = (
  shell: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<{ stdout: string; timedOut: boolean }>

/** After the shell exits, waits for the last data before handing control back. */
const EXIT_GRACE_MS = 250

/**
 * The timeout is a real bound: the promise resolves when the timer fires (partial stdout,
 * `timedOut`), without waiting for `close` — a grandchild launched by `.zshrc` (agent, daemon,
 * `cmd &`) may keep stdout open much longer. The shell is a group leader (`detached`): on
 * timeout, the whole group is killed so that no orphan is left behind.
 */
const defaultSpawnShell: SpawnShell = (shell, args, timeoutMs) =>
  new Promise((resolve) => {
    let stdout = ''
    let timedOut = false
    let settled = false
    let graceTimer: ReturnType<typeof setTimeout> | null = null
    let child: ChildProcess
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (graceTimer) clearTimeout(graceTimer)
      // Release the pipe: a grandchild that keeps it open must not hold the event loop.
      child?.stdout?.destroy()
      resolve({ stdout, timedOut })
    }
    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
      finish()
    }, timeoutMs)
    try {
      child = spawn(shell, args, {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { HOME: process.env.HOME ?? '', USER: process.env.USER ?? '', TERM: 'dumb' },
        detached: true,
      })
    } catch {
      finish()
      return
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) => {
      if (stdout.length < 256 * 1024) stdout += d
    })
    child.on('error', finish)
    // `exit` rather than `close`: `close` waits for all inheritable pipes to be closed.
    child.on('exit', () => {
      graceTimer = setTimeout(finish, EXIT_GRACE_MS)
    })
    child.on('close', finish)
  })

export interface ReadLoginShellOptions {
  shell?: string
  timeoutMs?: number
  spawnShell?: SpawnShell
}

/**
 * Runs `/bin/zsh -lic '<script>'` and returns the `PATH` and the tools found. Never throws:
 * on failure or timeout, returns whatever could be read (often empty).
 */
export async function readLoginShellEnv(opts: ReadLoginShellOptions = {}): Promise<LoginShellEnv> {
  const shell = opts.shell ?? '/bin/zsh'
  const run = opts.spawnShell ?? defaultSpawnShell
  try {
    const { stdout } = await run(
      shell,
      ['-lic', loginShellScript()],
      opts.timeoutMs ?? LOGIN_SHELL_TIMEOUT_MS,
    )
    return parseLoginShellOutput(stdout)
  } catch {
    return { path: null, tools: {} }
  }
}
