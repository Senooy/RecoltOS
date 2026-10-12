/**
 * Chromium GPU memory budgets: by default NO cap (`0` = Chromium's value, which
 * adapts to the screen size: ≈ 625 MB of tiles for a Retina 3024 × 1890 screen).
 *
 * A cap of 96 MB of tiles (`force-gpu-mem-available-mb`) and 64 MB of decoded images
 * (`force-gpu-mem-discardable-limit-mb`) had been set for the Spaces canvas. It did not hold for the
 * detail view: full-screen ambience, frosted glass, media and panel exceed 96 MB of tiles on Retina,
 * the tile manager kept running out of memory (`did_oom_on_last_assign`) and the compositor
 * drew missing tiles, as dark flat areas, on every navigation. These switches apply
 * to the whole process (impossible to limit them to one view): smoothness wins.
 *
 * Must be called BEFORE `ready`. `RECOLTOS_GPU_TILE_MB` / `RECOLTOS_GPU_DISCARDABLE_MB` set a
 * cap (A/B measurements); `0` or absent keeps Chromium's value.
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

/** Sets the switches; returns those that were set (for tests and the log). */
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
