/**
 * Équivalent Node de `utilityFork` pour les tests : `child_process.fork` du vrai
 * `media.worker.ts` chargé par tsx, transport `process.send` (sérialisation « advanced »).
 */
import { fork, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import type { ForkFn, WorkerChild } from '../../../src/main/workers-host'

export const ROOT = resolve(import.meta.dirname, '../../..')
export const MEDIA_WORKER_TS = resolve(ROOT, 'src/main/workers/media.worker.ts')

export interface NodeForkHandle {
  fork: ForkFn
  children: ChildProcess[]
  /** Tue le prochain enfant juste après l'envoi d'une requête `op`. */
  killAfterSend(op: string): void
}

export function nodeFork(): NodeForkHandle {
  const children: ChildProcess[] = []
  let killOn: string | null = null
  return {
    children,
    killAfterSend(op) {
      killOn = op
    },
    fork: (modulePath): WorkerChild => {
      const cp = fork(modulePath, [], {
        cwd: ROOT,
        execArgv: ['--import', 'tsx'],
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      })
      children.push(cp)
      return {
        get pid() {
          return cp.pid
        },
        postMessage: (msg) => {
          cp.send(msg)
          if (killOn !== null && msg.op === killOn) {
            killOn = null
            cp.kill('SIGKILL')
          }
        },
        onMessage: (cb) => {
          cp.on('message', (m) => cb(m))
        },
        onExit: (cb) => {
          cp.on('exit', (code, signal) => cb(code, signal))
        },
        kill: (signal) => {
          cp.kill(signal ?? 'SIGTERM')
        },
      }
    },
  }
}
