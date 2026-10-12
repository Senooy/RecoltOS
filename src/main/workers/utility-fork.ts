/**
 * `utilityProcess.fork` adapter (Electron) → `WorkerChild`. The standard output
 * of the worker is relayed to the main log (`stdio: 'pipe'`).
 */
import * as electron from 'electron'
import { join } from 'node:path'
import type { ForkFn, HostLogger, WorkerChild } from '../workers-host'

/**
 * Media-worker bundle next to `out/main/index.js`: `media.worker` entry of
 * `electron.vite.config.ts`.
 */
export function mediaWorkerPath(mainDir: string = __dirname): string {
  return join(mainDir, 'media.worker.js')
}

export function makeUtilityFork(log?: HostLogger): ForkFn {
  return (modulePath, { serviceName }): WorkerChild => {
    const proc = electron.utilityProcess.fork(modulePath, [], { serviceName, stdio: 'pipe' })
    const relay = (level: 'info' | 'warn') => (chunk: Buffer | string) => {
      const text = String(chunk).trimEnd()
      if (text) log?.[level](`[${serviceName}] ${text}`)
    }
    proc.stdout?.on('data', relay('info'))
    proc.stderr?.on('data', relay('warn'))
    // `proc.kill()` before the `spawn` event has no effect: the request is replayed on spawn.
    let spawned = false
    let killOnSpawn: NodeJS.Signals | null = null
    const doKill = (signal: NodeJS.Signals | undefined): void => {
      if (signal === 'SIGKILL' && proc.pid !== undefined) {
        try {
          process.kill(proc.pid, 'SIGKILL')
          return
        } catch {
          // already finished
        }
      }
      proc.kill()
    }
    proc.once('spawn', () => {
      spawned = true
      if (killOnSpawn) doKill(killOnSpawn)
    })
    return {
      get pid() {
        return proc.pid
      },
      postMessage: (msg) => proc.postMessage(msg),
      onMessage: (cb) => {
        proc.on('message', (m: unknown) => cb(m))
      },
      onExit: (cb) => {
        proc.on('exit', (code: number) => cb(code, null))
      },
      kill: (signal) => {
        if (!spawned) {
          killOnSpawn = killOnSpawn === 'SIGKILL' ? 'SIGKILL' : (signal ?? 'SIGTERM')
          return
        }
        doKill(signal)
      },
    }
  }
}
