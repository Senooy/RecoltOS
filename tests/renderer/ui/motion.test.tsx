// @vitest-environment happy-dom
import './_setup'
import { act, renderHook } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  DURATION,
  REDUCED_MAX_MS,
  isReducedMotion,
  motionDuration,
  motionSeconds,
  reduceMotionState,
  useReducedMotion,
} from '../../../src/renderer/src/components/ui/motion'

const uiCss = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ui/ui.css'), 'utf8')

function stubMatchMedia(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
}

describe('motionDuration (prefers-reduced-motion)', () => {
  it('mouvement normal : durée inchangée', () => {
    expect(motionDuration(340, false)).toBe(340)
    expect(motionDuration(DURATION.menuIn, false)).toBe(140)
  })
  it('mouvement réduit : plafonné à 80 ms', () => {
    expect(motionDuration(340, true)).toBe(REDUCED_MAX_MS)
    expect(motionDuration(240, true)).toBe(80)
    expect(motionDuration(60, true)).toBe(60)
    expect(motionDuration(-5, true)).toBe(0)
    expect(motionSeconds(340, true)).toBeCloseTo(0.08)
  })
  it('suit prefers-reduced-motion du système', () => {
    stubMatchMedia(true)
    expect(isReducedMotion()).toBe(true)
    expect(motionDuration(340)).toBe(80)
    stubMatchMedia(false)
    expect(isReducedMotion()).toBe(false)
    expect(motionDuration(340)).toBe(340)
  })
  it('suit le réglage « Toujours » (<html data-reduce-motion="1">)', () => {
    stubMatchMedia(false)
    document.documentElement.dataset.reduceMotion = '1'
    expect(isReducedMotion()).toBe(true)
    expect(motionDuration(340)).toBe(80)
  })
})

describe('reduceMotionState : ni translation, ni rotation, ni échelle', () => {
  const state = {
    opacity: 1,
    x: 12,
    y: -6,
    scale: 0.97,
    rotate: 4,
    transform: 'none',
    filter: 'none',
  }
  it('réduit : il ne reste que l’opacité et les propriétés non géométriques', () => {
    expect(reduceMotionState(state, true)).toEqual({ opacity: 1, filter: 'none' })
  })
  it('normal : état inchangé', () => {
    expect(reduceMotionState(state, false)).toBe(state)
  })
})

describe('useReducedMotion', () => {
  it('réagit au changement de l’attribut', async () => {
    stubMatchMedia(false)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
    await act(async () => {
      document.documentElement.dataset.reduceMotion = '1'
      await Promise.resolve()
    })
    expect(result.current).toBe(true)
  })
})

describe('ui.css : miroir CSS du mouvement réduit', () => {
  it('annule échelle et translation sous prefers-reduced-motion ET data-reduce-motion', () => {
    for (const marker of [
      '@media (prefers-reduced-motion: reduce)',
      ":root[data-reduce-motion='1']",
    ]) {
      const start = uiCss.indexOf(marker)
      expect(start, marker).toBeGreaterThan(-1)
      const block = uiCss.slice(start, uiCss.indexOf('}', start))
      expect(block).toMatch(/--ui-scale-from:\s*1/)
      expect(block).toMatch(/--ui-dialog-scale-from:\s*1/)
      expect(block).toMatch(/--ui-dialog-y-from:\s*0px/)
      expect(block).toMatch(/--ui-menu-in:\s*80ms/)
      expect(block).toMatch(/--ui-dialog-in:\s*80ms/)
    }
  })
  it('les keyframes ne translatent qu’à travers des variables remises à 0', () => {
    const keyframes = uiCss.match(/@keyframes ui-(pop|dialog)-(in|out)[^}]*}[^}]*}[^}]*}/g) ?? []
    expect(keyframes.length).toBe(4)
    for (const k of keyframes) {
      expect(k).not.toMatch(/translate(X|Y)?\(\s*-?\d/)
      expect(k).not.toMatch(/rotate\(/)
    }
  })
  it('le spinner n’a plus d’animation en mouvement réduit', () => {
    expect(uiCss).toMatch(/\.ui-spinner > svg \{\s*animation: none !important/)
  })
})
