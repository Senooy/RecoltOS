/**
 * Detects a process by exact name (`pgrep -x`), used for GatherOS
 * (importer "quit GatherOS", SYNC coexistence). No shell; `exec` injectable.
 */
import { execFile } from 'node:child_process'

export const PGREP = '/usr/bin/pgrep'
export const GATHEROS_PROCESS = 'GatherOS'

export type ExecFileFn = (
  cmd: string,
  args: readonly string[],
) => Promise<{ code: number; stdout: string }>

const defaultExec: ExecFileFn = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, [...args], { timeout: 5_000 }, (err, stdout) => {
      if (!err) {
        resolve({ code: 0, stdout: String(stdout) })
        return
      }
      const code = (err as { code?: unknown }).code
      if (typeof code === 'number') resolve({ code, stdout: String(stdout) })
      else reject(err instanceof Error ? err : new Error('pgrep: unexpected failure'))
    })
  })

/** Acceptable process name: no option, no pattern, bounded length. */
export function isSafeProcessName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(name)
}

/**
 * `true` if a process is named exactly `name`. `pgrep`: 0 = found, 1 = none;
 * any other code is an error.
 */
export async function isProcessRunning(
  name: string,
  exec: ExecFileFn = defaultExec,
): Promise<boolean> {
  if (!isSafeProcessName(name)) throw new Error(`invalid process name: ${name}`)
  const { code } = await exec(PGREP, ['-x', name])
  if (code === 0) return true
  if (code === 1) return false
  throw new Error(`pgrep failed (code ${code})`)
}

/** `isRunning` dependency injected into the importer. */
export function isGatherOSRunning(exec?: ExecFileFn): Promise<boolean> {
  return isProcessRunning(GATHEROS_PROCESS, exec)
}
