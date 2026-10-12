/**
 * Budgets mémoire GPU de Chromium : par défaut AUCUN plafond (`0` = valeur de Chromium, qui
 * s'adapte à la taille de l'écran : ≈ 625 Mo de tuiles pour un écran Retina 3024 × 1890).
 *
 * Un plafond de 96 Mo de tuiles (`force-gpu-mem-available-mb`) et de 64 Mo d'images décodées
 * (`force-gpu-mem-discardable-limit-mb`) avait été posé pour la toile Spaces. Il ne tenait pas la vue
 * détail : ambiance plein écran, verre flouté, média et panneau dépassent 96 Mo de tuiles en Retina,
 * le gestionnaire de tuiles restait en manque de mémoire (`did_oom_on_last_assign`) et le compositeur
 * dessinait des tuiles absentes, en aplats sombres, à chaque navigation. Ces commutateurs valent
 * pour tout le processus (impossible de les limiter à une vue) : la fluidité prime.
 *
 * Doit être appelé AVANT `ready`. `RECOLTOS_GPU_TILE_MB` / `RECOLTOS_GPU_DISCARDABLE_MB` posent un
 * plafond (mesures A/B) ; `0` ou absent laisse la valeur de Chromium.
 */
export const GPU_TILE_MB = 0
export const GPU_DISCARDABLE_MB = 0

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
