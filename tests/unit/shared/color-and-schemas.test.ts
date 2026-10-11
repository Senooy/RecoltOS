import { describe, expect, it } from 'vitest'
import {
  NEUTRAL_BUCKET,
  UNKNOWN_BUCKET,
  deltaE76,
  hexToLab,
  hueBucket,
  labToHex,
  labToLch,
} from '../../../src/shared/color'
import { parsePostMeta } from '../../../src/shared/post-meta'
import {
  MIN_NODE_SIZE,
  SpaceNode,
  normalizeRotation,
  sanitizeNode,
} from '../../../src/shared/spaces-schema'
import { SaveRequest } from '../../../src/shared/bridge/save'
import { Envelope } from '../../../src/shared/bridge/envelope'

const U = '0decd148-5f3c-4d7a-9b1e-2a3b4c5d6e7f'

describe('color', () => {
  it('Lab D65 de référence', () => {
    const [l, a, b] = hexToLab('#ffffff')
    expect(l).toBeCloseTo(100, 2)
    expect(Math.abs(a)).toBeLessThan(0.01)
    expect(Math.abs(b)).toBeLessThan(0.01)
    const red = hexToLab('#ff0000')
    expect(red[0]).toBeCloseTo(53.24, 1)
    expect(red[1]).toBeCloseTo(80.09, 1)
    expect(red[2]).toBeCloseTo(67.2, 1)
  })
  it('aller-retour hex → Lab → hex', () => {
    for (const h of ['#000000', '#fafafa', '#c47f5a', '#0a84ff', '#123456'])
      expect(labToHex(hexToLab(h))).toBe(h)
  })
  it('buckets de teinte', () => {
    expect(hueBucket(labToLch(hexToLab('#808080')))).toBe(NEUTRAL_BUCKET)
    expect(hueBucket(null)).toBe(UNKNOWN_BUCKET)
    expect(hueBucket(labToLch(hexToLab('#ff0000')))).toBe(1)
    expect(deltaE76(hexToLab('#ff0000'), hexToLab('#ff0000'))).toBe(0)
  })
})

describe('post-meta', () => {
  it('lecture tolérante', () => {
    const ok = parsePostMeta(
      JSON.stringify({
        v: 1,
        platform: 'x',
        author: null,
        text: 'salut',
        url: null,
        postedAt: null,
      }),
    )
    expect(ok?.media).toEqual([])
    expect(ok?.quoted).toBeNull()
    let err = 0
    expect(parsePostMeta('{"v":2}', () => err++)).toBeNull()
    expect(parsePostMeta('pas du json', () => err++)).toBeNull()
    expect(err).toBe(2)
    expect(parsePostMeta(null)).toBeNull()
  })
})

describe('spaces-schema', () => {
  const note = {
    uuid: U,
    type: 'note',
    x: 0,
    y: 0,
    width: 220,
    height: 220,
    z: 1,
    createdAt: 1,
    updatedAt: 1,
    content: 'Idée',
    style: { color: 'yellow', fontSize: 18, align: 'left' },
  }
  it('valide une note et applique les défauts', () => {
    const n = SpaceNode.parse(note)
    expect(n.rotation).toBe(0)
    expect(n.locked).toBe(false)
  })
  it(`refuse une taille < ${MIN_NODE_SIZE}, une clé de style inconnue, une couleur hors palette`, () => {
    expect(SpaceNode.safeParse({ ...note, width: 23 }).success).toBe(false)
    expect(SpaceNode.safeParse({ ...note, style: { ...note.style, bold: true } }).success).toBe(
      false,
    )
    expect(
      SpaceNode.safeParse({ ...note, style: { ...note.style, color: 'orange' } }).success,
    ).toBe(false)
    expect(SpaceNode.safeParse({ ...note, x: Number.NaN }).success).toBe(false)
    expect(sanitizeNode({ ...note, type: 'frame' })).toBeNull()
  })
  it('normalise la rotation dans ]-180, 180]', () => {
    expect(normalizeRotation(190)).toBe(-170)
    expect(normalizeRotation(-180)).toBe(180)
    expect(normalizeRotation(540)).toBe(180)
  })
})

describe('bridge (stubs typés)', () => {
  it('enveloppe et SaveRequest', () => {
    expect(Envelope.safeParse({ v: 1, id: U, type: 'ping', payload: {} }).success).toBe(true)
    expect(Envelope.safeParse({ v: 2, id: U, type: 'ping' }).success).toBe(false)
    const base = { kind: 'image', pageUrl: 'https://x.com/a/status/1' }
    expect(SaveRequest.safeParse(base).success).toBe(true)
    expect(
      SaveRequest.safeParse({
        ...base,
        inlineMedia: { mime: 'image/png', dataBase64: 'AA==' },
        upload: { id: U, mime: 'image/png', size: 1 },
      }).success,
    ).toBe(false)
    expect(SaveRequest.safeParse({ ...base, inconnu: 1 }).success).toBe(false)
  })
})
