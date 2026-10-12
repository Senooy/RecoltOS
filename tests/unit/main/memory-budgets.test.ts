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

describe('applyMemoryBudgets', () => {
  it('aucun plafond GPU par défaut (valeurs de Chromium)', () => {
    const s = sink()
    const out = applyMemoryBudgets(s, {})
    expect(GPU_TILE_MB).toBe(0)
    expect(GPU_DISCARDABLE_MB).toBe(0)
    expect(s.calls).toEqual([])
    expect(out).toEqual({})
  })

  it('pose les plafonds demandés pour une mesure A/B', () => {
    const s = sink()
    applyMemoryBudgets(s, { RECOLTOS_GPU_TILE_MB: '96', RECOLTOS_GPU_DISCARDABLE_MB: '64' })
    expect(s.calls).toEqual([
      ['force-gpu-mem-available-mb', '96'],
      ['force-gpu-mem-discardable-limit-mb', '64'],
    ])
  })

  it('accepte des valeurs de mesure et `0` pour laisser le défaut de Chromium', () => {
    const s = sink()
    applyMemoryBudgets(s, { RECOLTOS_GPU_TILE_MB: '0', RECOLTOS_GPU_DISCARDABLE_MB: '128' })
    expect(s.calls).toEqual([['force-gpu-mem-discardable-limit-mb', '128']])
  })

  it('ignore une valeur invalide (valeur par défaut : aucun plafond)', () => {
    const s = sink()
    applyMemoryBudgets(s, { RECOLTOS_GPU_TILE_MB: 'beaucoup', RECOLTOS_GPU_DISCARDABLE_MB: '-3' })
    expect(s.calls).toEqual([])
  })
})
