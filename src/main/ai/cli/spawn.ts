/**
 * `runCli` : process en groupe (`detached`), stdin FERMÉ (`ignore` : codex ajouterait
 * stdin au prompt), délai, annulation et garde-fou ligne à ligne (`onLine` → 'kill'), plafond de
 * sortie (8 Mo). Arrêt : SIGTERM au groupe, puis SIGKILL après 3 s.
 */
import { spawn, type ChildProcess } from 'node:child_process'

export interface RunCliOptions {
  bin: string
  args: readonly string[]
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  signal?: AbortSignal
  maxBytes?: number
  onLine?: (line: string, stream: 'stdout' | 'stderr') => 'kill' | void
}

export interface RunCliResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
  killedByGuard: boolean
  aborted: boolean
  /** Erreur de lancement (`ENOENT`, `EACCES`…). */
  spawnError?: NodeJS.ErrnoException
}

export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
const KILL_GRACE_MS = 3_000

function killGroup(child: ChildProcess, sig: NodeJS.Signals): void {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, sig)
  } catch {
    try {
      child.kill(sig)
    } catch {
      // déjà terminé
    }
  }
}

export function runCli(o: RunCliOptions): Promise<RunCliResult> {
  const started = Date.now()
  const max = o.maxBytes ?? DEFAULT_MAX_BYTES
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let killedByGuard = false
    let aborted = false
    let settled = false
    let killTimer: NodeJS.Timeout | null = null
    let child: ChildProcess
    const bufs = { stdout: '', stderr: '' }

    const stop = () => {
      killGroup(child, 'SIGTERM')
      if (!killTimer) {
        killTimer = setTimeout(() => killGroup(child, 'SIGKILL'), KILL_GRACE_MS)
        killTimer.unref?.()
      }
    }
    const finish = (
      code: number | null,
      signal: NodeJS.Signals | null,
      err?: NodeJS.ErrnoException,
    ) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      o.signal?.removeEventListener('abort', onAbort)
      // Dernière ligne sans saut de ligne.
      for (const s of ['stdout', 'stderr'] as const) {
        if (bufs[s] && !killedByGuard) o.onLine?.(bufs[s], s)
      }
      resolve({
        code,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
        killedByGuard,
        aborted,
        ...(err ? { spawnError: err } : {}),
      })
    }
    const onAbort = () => {
      aborted = true
      stop()
    }
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, o.timeoutMs)
    timer.unref?.()

    try {
      child = spawn(o.bin, [...o.args], {
        cwd: o.cwd,
        env: o.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      })
    } catch (err) {
      finish(null, null, err as NodeJS.ErrnoException)
      return
    }
    if (o.signal?.aborted) onAbort()
    else o.signal?.addEventListener('abort', onAbort, { once: true })

    const feed = (stream: 'stdout' | 'stderr', chunk: string) => {
      if (stream === 'stdout') {
        if (stdout.length < max) stdout += chunk
      } else if (stderr.length < max) stderr += chunk
      if ((stream === 'stdout' ? stdout : stderr).length >= max && !killedByGuard) {
        killedByGuard = true
        stop()
      }
      if (!o.onLine || killedByGuard) return
      bufs[stream] += chunk
      let i: number
      while ((i = bufs[stream].indexOf('\n')) >= 0) {
        const line = bufs[stream].slice(0, i)
        bufs[stream] = bufs[stream].slice(i + 1)
        if (line && o.onLine(line, stream) === 'kill') {
          killedByGuard = true
          stop()
          return
        }
      }
    }
    child.stdout?.setEncoding('utf8').on('data', (d: string) => feed('stdout', d))
    child.stderr?.setEncoding('utf8').on('data', (d: string) => feed('stderr', d))
    child.on('error', (err: NodeJS.ErrnoException) => finish(null, null, err))
    child.on('close', (code, signal) => finish(code, signal))
  })
}
