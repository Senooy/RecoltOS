/**
 * Mise à jour sans boucle : un seul `runtime.reload()` par version livrée ; ensuite
 * `ext.stale` (extension chargée depuis un autre dossier).
 */
import { api } from '../lib/api'

export async function maybeReload(
  bundled: string,
  current: string,
  onStale: (p: { extVersion: string; bundledExtVersion: string }) => void,
): Promise<'reloaded' | 'stale'> {
  const a = api()
  const got: unknown = await a.storage.local.get('reloadAttemptedFor')
  if ((got as { reloadAttemptedFor?: string } | undefined)?.reloadAttemptedFor !== bundled) {
    await a.storage.local.set({ reloadAttemptedFor: bundled })
    a.runtime.reload()
    return 'reloaded'
  }
  onStale({ extVersion: current, bundledExtVersion: bundled })
  return 'stale'
}
