import { describe, expect, it } from 'vitest'
import {
  GPU_DISCARDABLE_MB,
  GPU_TILE_MB,
  applyMemoryBudgets,
} from '../../../src/main/bootstrap/memory'

function sink() {
  const calls: [string, string | undefined][] = []
  return { calls, appendSwitch: (n: string, v?: string) => void calls.push([n, v]) }
}

describe('applyMemoryBudgets (WP-71)', () => {
  it('pose les deux budgets GPU par défaut', () => {
    const s = sink()
    const out = applyMemoryBudgets(s, {})
    expect(s.calls).toEqual([
      ['force-gpu-mem-available-mb', String(GPU_TILE_MB)],
      ['force-gpu-mem-discardable-limit-mb', String(GPU_DISCARDABLE_MB)],
    ])
    expect(out['force-gpu-mem-available-mb']).toBe('96')
  })

  it('accepte des valeurs de mesure et `0` pour laisser le défaut de Chromium', () => {
    const s = sink()
    applyMemoryBudgets(s, { RECOLTOS_GPU_TILE_MB: '0', RECOLTOS_GPU_DISCARDABLE_MB: '128' })
    expect(s.calls).toEqual([['force-gpu-mem-discardable-limit-mb', '128']])
  })

  it('ignore une valeur invalide', () => {
    const s = sink()
    applyMemoryBudgets(s, { RECOLTOS_GPU_TILE_MB: 'beaucoup', RECOLTOS_GPU_DISCARDABLE_MB: '-3' })
    expect(s.calls.map((c) => c[1])).toEqual([String(GPU_TILE_MB), String(GPU_DISCARDABLE_MB)])
  })
})
