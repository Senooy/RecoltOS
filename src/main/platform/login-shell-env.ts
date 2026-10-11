/**
 * Environnement du shell de login (ARCHI §2.6) : une app lancée depuis le Finder hérite d'un
 * `PATH` minimal et ne voit ni `claude`, ni `codex`, ni `/opt/homebrew/bin/ffmpeg`.
 * On interroge `zsh -lic` (timeout 5 s) ; chaque outil est imprimé sur une ligne balisée pour
 * résister aux sorties parasites de `.zshrc` (invites, extensions) et aux outils absents.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { isAbsolute } from 'node:path'

export const LOGIN_SHELL_TOOLS = ['claude', 'codex', 'ffmpeg', 'ffprobe'] as const
export type LoginShellTool = (typeof LOGIN_SHELL_TOOLS)[number]

export interface LoginShellEnv {
  /** `PATH` du shell de login, ou `null` si introuvable. */
  path: string | null
  /** Chemins absolus trouvés par `command -v`. */
  tools: Partial<Record<LoginShellTool, string>>
}

export const LOGIN_SHELL_TIMEOUT_MS = 5_000
const MARK = '__RECOLT__'

export function loginShellScript(tools: readonly string[] = LOGIN_SHELL_TOOLS): string {
  const lines = [`printf '${MARK}PATH=%s\\n' "$PATH"`]
  for (const t of tools) {
    // Noms figés (pas d'entrée utilisateur) : aucune interpolation dangereuse.
    lines.push(`printf '${MARK}${t}=%s\\n' "$(command -v ${t} 2>/dev/null)"`)
  }
  return lines.join('; ')
}

/** Analyse la sortie balisée ; ignore tout le reste (exportée pour les tests). */
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
      // `command -v` rend un nom nu pour un alias ou une fonction : seuls les chemins absolus comptent.
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

/** Après la sortie du shell, attente des dernières données avant de rendre la main. */
const EXIT_GRACE_MS = 250

/**
 * Le délai est une vraie borne : la promesse se résout au déclenchement du timer (stdout
 * partiel, `timedOut`), sans attendre `close` — un petit-enfant lancé par `.zshrc` (agent,
 * démon, `cmd &`) peut garder stdout ouvert bien plus longtemps. Le shell est un chef de groupe
 * (`detached`) : au délai, on tue tout le groupe pour ne laisser aucun orphelin.
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
      // Libère le tuyau : un petit-enfant qui le garde ouvert ne doit pas retenir la boucle.
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
    // `exit` plutôt que `close` : `close` attend la fermeture de tous les tuyaux héritables.
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
 * Lance `/bin/zsh -lic '<script>'` et renvoie le `PATH` et les outils trouvés. Ne lève jamais :
 * en cas d'échec ou de délai dépassé, renvoie ce qui a pu être lu (souvent vide).
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
