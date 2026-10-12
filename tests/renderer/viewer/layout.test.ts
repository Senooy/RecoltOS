import { describe, expect, it } from 'vitest'
import {
  PLAYER_GAP,
  PLAYER_H,
  clampPan,
  fitMedia,
  stageRect,
  zoomRect,
  zoomStep,
} from '../../../src/renderer/src/features/viewer/layout'

describe('detail view geometry', () => {
  it('video 3:2 in a 1280×820 window with panel: media and player within ±1 pt', () => {
    const stage = stageRect(1280, 820, true)
    expect(stage).toEqual({ x: 0, y: 45, w: 992, h: 775 })
    const fit = fitMedia(stage, 1920, 1280, PLAYER_H + PLAYER_GAP)
    // Reference measurements: media 53,6 → 938 in x, 137,6 → 727,2 in y.
    expect(fit.x).toBeCloseTo(54, 0)
    expect(fit.w).toBeCloseTo(884, 0)
    expect(Math.abs(fit.y - 137.6)).toBeLessThan(1)
    expect(Math.abs(fit.y + fit.h - 727.2)).toBeLessThan(1)
  })

  it('without panel, the scene takes the full width', () => {
    expect(stageRect(1280, 820, false).w).toBe(1280)
  })

  it('portrait image limited by height and centered', () => {
    const stage = stageRect(1280, 820, true)
    const fit = fitMedia(stage, 1000, 2000)
    expect(fit.h).toBeCloseTo(775 - 80, 5)
    expect(fit.x + fit.w / 2).toBeCloseTo(496, 5)
  })

  it('zoom around the center, steps and bounded panning', () => {
    const fit = { x: 100, y: 100, w: 400, h: 200 }
    const z = zoomRect(fit, 2, { x: 0, y: 0 })
    expect(z).toEqual({ x: -100, y: 0, w: 800, h: 400 })
    expect(zoomStep(1, 1)).toBe(1.25)
    expect(zoomStep(1, -1)).toBe(0.9)
    expect(zoomStep(3, 1)).toBe(3)
    expect(zoomStep(0.25, -1)).toBe(0.25)
    expect(clampPan(fit, 1, { x: 50, y: 50 })).toEqual({ x: 0, y: 0 })
    expect(clampPan(fit, 2, { x: 10_000, y: -10_000 })).toEqual({ x: 300, y: -150 })
  })
})
