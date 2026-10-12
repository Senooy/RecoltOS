/**
 * Budgets mémoire GPU de Chromium. Mesuré sur la toile de 500 nœuds en Retina
 * (`tests/perf/spaces.spec.ts`, `docs/perf.md`) : sans borne, le processus GPU gardait jusqu'à
 * ~750 Mo de textures (tuiles de prérendu et images décodées) après un zoom ou une exploration ;
 * ces deux budgets le ramènent à ~250–400 Mo sans perte de fluidité (60 images/s, p95 ≤ 18 ms).
 *
 *  - `force-gpu-mem-available-mb` : mémoire des tuiles du compositeur. 96 Mo ≈ 4 écrans Retina
 *    3024 × 1890 : la vue et son prérendu tiennent largement.
 *  - `force-gpu-mem-discardable-limit-mb` : cache GPU des images décodées (jetable).
 *
 * Doit être appelé AVANT `ready`. `RECOLTOS_GPU_TILE_MB` / `RECOLTOS_GPU_DISCARDABLE_MB`
 * remplacent les valeurs (mesures A/B) ; `0` laisse la valeur par défaut de Chromium.
 */
export const GPU_TILE_MB = 96
export const GPU_DISCARDABLE_MB = 64

export interface SwitchSink {
  appendSwitch(name: string, value?: string): void
}

function budget(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 && n <= 65_536 ? n : fallback
}

/** Pose les commutateurs ; renvoie ceux qui ont été posés (pour les tests et le journal). */
export function applyMemoryBudgets(
  cl: SwitchSink,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const out: Record<string, string> = {}
  const tile = budget(env.RECOLTOS_GPU_TILE_MB, GPU_TILE_MB)
  const discardable = budget(env.RECOLTOS_GPU_DISCARDABLE_MB, GPU_DISCARDABLE_MB)
  if (tile > 0) out['force-gpu-mem-available-mb'] = String(tile)
  if (discardable > 0) out['force-gpu-mem-discardable-limit-mb'] = String(discardable)
  for (const [k, v] of Object.entries(out)) cl.appendSwitch(k, v)
  return out
}
