/**
 * analyse de l'en-tête Range.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseRange } from '../../../src/main/protocol/range'

describe('parseRange', () => {
  const size = 1000

  it('sans en-tête : réponse complète', () => {
    expect(parseRange(null, size)).toEqual({ kind: 'none' })
    expect(parseRange(undefined, size)).toEqual({ kind: 'none' })
  })

  it.each([
    ['bytes=0-99', 0, 99],
    ['bytes=100-', 100, 999],
    ['bytes=0-0', 0, 0],
    ['bytes=999-999', 999, 999],
    ['bytes=-500', 500, 999],
    ['bytes=-1', 999, 999],
    ['bytes=-5000', 0, 999],
    ['bytes=900-5000', 900, 999],
    [' bytes=10-20 ', 10, 20],
    ['Bytes=0-1', 0, 1],
    ['BYTES=-500', 500, 999],
    ['bytes=0-99999999999999999999999', 0, 999],
    ['bytes=900-99999999999999999999999', 900, 999],
    ['bytes=-99999999999999999999999', 0, 999],
  ])('%s → [%i, %i]', (header, start, end) => {
    expect(parseRange(header, size)).toEqual({ kind: 'partial', start, end })
  })

  it.each([
    'bytes=1000-',
    'bytes=1000-1001',
    'bytes=5000-6000',
    'bytes=20-10',
    'bytes=-0',
    'bytes=-',
    'bytes=0-1,5-6',
    'items=0-1',
    'bytes=a-b',
    'bytes=1e3-',
    '',
  ])('%j → 416', (header) => {
    expect(parseRange(header, size)).toEqual({ kind: 'unsatisfiable' })
  })

  it('fichier vide : toute plage est insatisfaisable', () => {
    expect(parseRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=-10', 0)).toEqual({ kind: 'unsatisfiable' })
  })

  it('propriété : une plage acceptée est toujours dans le fichier', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1e9 }),
        fc.option(fc.nat(2e9), { nil: undefined }),
        fc.option(fc.nat(2e9), { nil: undefined }),
        (sz, a, b) => {
          const header = `bytes=${a ?? ''}-${b ?? ''}`
          const r = parseRange(header, sz)
          if (r.kind !== 'partial') return true
          return r.start >= 0 && r.start <= r.end && r.end <= sz - 1
        },
      ),
    )
  })
})
