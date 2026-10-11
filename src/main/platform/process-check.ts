/**
 * Détection d'un processus par nom exact (`pgrep -x`), utilisée pour GatherOS
 * (QA §2 : importeur « quitte GatherOS », coexistence SYNC). Sans shell ; `exec` injectable.
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
      else reject(err instanceof Error ? err : new Error('pgrep : échec inattendu'))
    })
  })

/** Nom de processus acceptable : pas d'option, pas de motif, longueur bornée. */
export function isSafeProcessName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(name)
}

/**
 * `true` si un processus s'appelle exactement `name`. `pgrep` : 0 = trouvé, 1 = aucun ;
 * tout autre code est une erreur.
 */
export async function isProcessRunning(
  name: string,
  exec: ExecFileFn = defaultExec,
): Promise<boolean> {
  if (!isSafeProcessName(name)) throw new Error(`nom de processus invalide : ${name}`)
  const { code } = await exec(PGREP, ['-x', name])
  if (code === 0) return true
  if (code === 1) return false
  throw new Error(`pgrep a échoué (code ${code})`)
}

/** Dépendance `isRunning` injectée dans l'importeur (QA §2.4). */
export function isGatherOSRunning(exec?: ExecFileFn): Promise<boolean> {
  return isProcessRunning(GATHEROS_PROCESS, exec)
}
