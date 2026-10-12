/** Étagère : choix des vidéos lues et champ d'étoiles déterministe. */
import { describe, expect, it } from 'vitest'
import {
  MAX_PLAYING,
  SHELF_PAD_LEFT,
  SHELF_STEP,
  playingIndices,
} from '../../../src/renderer/src/features/collections/shelf/CollectionShelf'
import { makeStars } from '../../../src/renderer/src/features/collections/shelf/Starfield'
import { X_LOGO_PATH } from '../../../src/renderer/src/components/icons/brand'

describe('playingIndices', () => {
  it('au plus 4 vidéos, les plus proches du centre', () => {
    const isVideo = Array.from({ length: 17 }, () => true)
    const set = playingIndices(isVideo, 0, 1280)
    expect(set.size).toBe(MAX_PLAYING)
    // Centre 640 : créneaux 3 et 4 (centres 579 et 701), puis 2 et 5.
    const centers = [...set].map((i) => SHELF_PAD_LEFT + SHELF_STEP * (i + 0.5))
    for (const c of centers) expect(Math.abs(c - 640)).toBeLessThan(250)
  })
  it('ignore les couvertures qui ne sont pas des vidéos et suit le défilement', () => {
    const isVideo = [false, true, false, true, true, false, true, true, true]
    const a = playingIndices(isVideo, 0, 1280)
    expect([...a].every((i) => isVideo[i])).toBe(true)
    const b = playingIndices(isVideo, 600, 1280)
    expect(b.has(8)).toBe(true)
  })
})

describe('Starfield', () => {
  it('≈ 220 étoiles pour 1280×820, tirage reproductible, rayons et opacités bornés', () => {
    const a = makeStars(1280, 820)
    expect(a.length).toBe(220)
    expect(makeStars(1280, 820)).toEqual(a)
    for (const s of a) {
      expect(s.r).toBeGreaterThanOrEqual(0.5)
      expect(s.r).toBeLessThanOrEqual(1.3)
      expect(s.a).toBeGreaterThanOrEqual(0.15)
      expect(s.a).toBeLessThanOrEqual(0.9)
    }
    const twinkling = a.filter((s) => s.twinkle).length / a.length
    expect(twinkling).toBeGreaterThan(0.04)
    expect(twinkling).toBeLessThan(0.18)
  })
})

describe('logo X', () => {
  it('formes pleines (4 sous-chemins fermés), pas deux traits croisés', () => {
    expect(X_LOGO_PATH.match(/Z/g)?.length).toBe(4)
  })
})
