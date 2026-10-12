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
  it('no GPU cap by default (Chromium values)', () => {
    const s = sink()
    const out = applyMemoryBudgets(s, {})
    expect(GPU_TILE_MB).toBe(0)
    expect(GPU_DISCARDABLE_MB).toBe(0)
    expect(s.calls).toEqual([])
    expect(out).toEqual({})
  })

  it('sets the requested caps for an A/B measurement', () => {
    const s = sink()
    applyMemoryBudgets(s, { RECOLTOS_GPU_TILE_MB: '96', RECOLTOS_GPU_DISCARDABLE_MB: '64' })
    expect(s.calls).toEqual([
      ['force-gpu-mem-available-mb', '96'],
      ['force-gpu-mem-discardable-limit-mb', '64'],
    ])
  })

  it('accepts measurement values and `0` to keep the Chromium default', () => {
    const s = sink()
    applyMemoryBudgets(s, { RECOLTOS_GPU_TILE_MB: '0', RECOLTOS_GPU_DISCARDABLE_MB: '128' })
    expect(s.calls).toEqual([['force-gpu-mem-discardable-limit-mb', '128']])
  })

  it('ignores an invalid value (default: no cap)', () => {
    const s = sink()
    applyMemoryBudgets(s, { RECOLTOS_GPU_TILE_MB: 'beaucoup', RECOLTOS_GPU_DISCARDABLE_MB: '-3' })
    expect(s.calls).toEqual([])
  })
})
