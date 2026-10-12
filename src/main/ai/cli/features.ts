/**
 * Isolating codex: `--ignore-user-config` is not enough; each active feature that
 * could run, navigate or load extensions must be disabled. The list
 * is COMPUTED at runtime from `codex features list`: only the lines of
 * `DISABLE_CANDIDATES` in `stable` / `experimental` set to `true` (never a `removed` or unknown name,
 * which would make the command fail). Cache per codex version.
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
