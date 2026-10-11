/**
 * Outils du media-worker (ARCHI §1.4, §2.2) : chemins explicites, exécution sans shell,
 * erreurs typées. Les workers ne se fient jamais au `PATH` (ARCHI §2.6).
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { AppError } from '../../../shared/errors'

/** Chemins absolus des binaires, résolus par main (`platform/binaries.ts`). */
export interface MediaTools {
  ffmpeg?: string | undefined
  ffprobe?: string | undefined
  /** Toujours `/usr/bin/sips` sur macOS. */
  sips?: string | undefined
}

export type ToolName = 'ffmpeg' | 'ffprobe' | 'sips'

export const DEFAULT_SIPS = '/usr/bin/sips'

export function toolMissing(tool: ToolName): AppError {
  const hint =
    tool === 'sips'
      ? 'sips est introuvable (/usr/bin/sips).'
      : `${tool} est introuvable : installe-le avec « brew install ffmpeg » puis clique sur Re-détecter.`
  return new AppError('tool_missing', hint, { tool })
}

export function requireTool(tools: MediaTools, tool: ToolName): string {
  const p = tools[tool]
  if (!p) throw toolMissing(tool)
  return p
}

export function assertAbs(p: unknown, field: string): string {
  if (typeof p !== 'string' || p.length === 0 || !isAbsolute(p) || p.includes('\0')) {
    throw new AppError('validation', `chemin absolu attendu (champ ${field})`)
  }
  return p
}

export interface RunResult {
  stdout: string
  stderr: string
}

export interface RunOptions {
  timeoutMs?: number
  signal?: AbortSignal | undefined
  /** Outil logique, pour l'erreur `tool_missing` si le binaire n'existe pas. */
  tool: ToolName
}

const MAX_CAPTURE = 4 * 1024 * 1024

/**
 * Lance `cmd args` sans shell. ENOENT/EACCES → `tool_missing` ; code ≠ 0 → `tool_failed`
 * (stderr tronqué dans le message) ; dépassement → `timeout` ; annulation → `cancelled`.
 */
export function run(cmd: string, args: readonly string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new AppError('cancelled', 'opération annulée'))
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: minimalEnv() })
    const done = (fn: () => void): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const onAbort = (): void => {
      child.kill('SIGKILL')
      done(() => reject(new AppError('cancelled', 'opération annulée')))
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const timer =
      opts.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true
            child.kill('SIGKILL')
          }, opts.timeoutMs)
        : null
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d: string) => {
      if (stdout.length < MAX_CAPTURE) stdout += d
    })
    child.stderr.on('data', (d: string) => {
      if (stderr.length < MAX_CAPTURE) stderr += d
    })
    child.on('error', (err: NodeJS.ErrnoException) => {
      done(() =>
        reject(
          err.code === 'ENOENT' || err.code === 'EACCES'
            ? toolMissing(opts.tool)
            : new AppError('tool_failed', `${basename(cmd)} : ${err.message}`),
        ),
      )
    })
    child.on('close', (code, signal) => {
      done(() => {
        if (timedOut) {
          reject(new AppError('timeout', `${basename(cmd)} a dépassé le délai`))
        } else if (code === 0) {
          resolve({ stdout, stderr })
        } else {
          const tail = stderr.trim().split('\n').slice(-3).join(' | ').slice(0, 500)
          reject(
            new AppError(
              'tool_failed',
              `${basename(cmd)} a échoué (${code ?? signal ?? '?'})${tail ? ` : ${tail}` : ''}`,
            ),
          )
        }
      })
    })
  })
}

/** Environnement réduit : pas d'héritage de secrets ; locale stable pour parser les sorties. */
function minimalEnv(): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'C',
    LC_ALL: 'C',
    HOME: process.env.HOME ?? '/tmp',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
  }
}

/** Nom temporaire à côté de `dst` (même volume → `rename` atomique), extension conservée. */
export function tmpSibling(dst: string, ext = extname(dst)): string {
  const tag = `${process.pid}-${randomBytes(4).toString('hex')}`
  return join(dirname(dst), `.${basename(dst, extname(dst))}.${tag}.part${ext}`)
}

/**
 * Écrit via un fichier temporaire puis `rename` : un lecteur ne voit jamais de fichier partiel.
 * Le temporaire est supprimé en cas d'échec.
 */
export async function writeAtomic<T>(
  dst: string,
  write: (tmp: string) => Promise<T>,
  ext?: string,
): Promise<T> {
  await mkdir(dirname(dst), { recursive: true })
  const tmp = tmpSibling(dst, ext)
  try {
    const out = await write(tmp)
    await rename(tmp, dst)
    return out
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}
