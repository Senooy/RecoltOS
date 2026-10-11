/**
 * Adaptateur `utilityProcess.fork` (Electron) → `WorkerChild` (ARCHI §2.2). La sortie standard
 * du worker est relayée vers le journal de main (`stdio: 'pipe'`).
 */
import * as electron from 'electron'
import { join } from 'node:path'
import type { ForkFn, HostLogger, WorkerChild } from '../workers-host'

/**
 * Bundle du media-worker à côté de `out/main/index.js` : entrée `media.worker` de
 * `electron.vite.config.ts` (demande de contrat WP-03, `docs/contrats/CHANGELOG.md`).
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
        if (signal === 'SIGKILL' && proc.pid !== undefined) {
          try {
            process.kill(proc.pid, 'SIGKILL')
            return
          } catch {
            // déjà terminé
          }
        }
        proc.kill()
      },
    }
  }
}
