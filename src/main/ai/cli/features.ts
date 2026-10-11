/**
 * Isolation de codex (AI §1.2, §3.2) : `--ignore-user-config` ne suffit pas, il faut désactiver
 * chaque fonctionnalité active susceptible d'exécuter, naviguer ou charger des extensions. La liste
 * est CALCULÉE à l'exécution depuis `codex features list` : seules les lignes de
 * `DISABLE_CANDIDATES` en `stable` / `experimental` à `true` (jamais un nom `removed` ou inconnu,
 * qui ferait échouer la commande). Cache par version de codex.
 */
export const DISABLE_CANDIDATES = [
  'shell_tool',
  'unified_exec',
  'view_image',
  'apps',
  'plugins',
  'remote_plugin',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'in_app_browser',
  'computer_use',
  'image_generation',
  'multi_agent',
  'skill_search',
  'tool_suggest',
  'goals',
  'hooks',
] as const

export function parseFeaturesList(out: string): string[] {
  const active: string[] = []
  const wanted = new Set<string>(DISABLE_CANDIDATES)
  for (const line of out.split(/\r?\n/)) {
    const m =
      /^(\S+)\s+(stable|experimental|under development|deprecated|removed)\s+(true|false)\s*$/.exec(
        line.trim(),
      )
    if (!m) continue
    const [, name, stage, value] = m
    if (!wanted.has(name!)) continue
    if ((stage === 'stable' || stage === 'experimental') && value === 'true') active.push(name!)
  }
  return active
}

export function disableArgs(features: readonly string[]): string[] {
  return features.flatMap((f) => ['--disable', f])
}

const cache = new Map<string, string[]>()

export async function codexDisableList(
  version: string | undefined,
  list: () => Promise<string>,
): Promise<string[]> {
  const key = version ?? '?'
  const hit = cache.get(key)
  if (hit) return hit
  const out = await list()
  const active = parseFeaturesList(out)
  if (version) cache.set(key, active)
  return active
}

export function clearFeaturesCache(): void {
  cache.clear()
}
