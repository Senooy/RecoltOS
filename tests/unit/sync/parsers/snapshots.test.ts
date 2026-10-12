/**
 * Toutes les fixtures (erreurs comprises) → sortie figée en snapshot (acceptance).
 */
import { describe, expect, it } from 'vitest'
import { parseInstagramMediaInfo, parseSyncPage } from '../../../../src/main/sync/parsers'
import { checkInvariants, fixture, fixtureNames, type Dir } from './helpers'

const PLATFORM = { x: 'x', instagram: 'instagram', cosmos: 'cosmos' } as const

describe.each(['x', 'instagram', 'cosmos'] as Dir[])('snapshots %s', (dir) => {
  it.each(fixtureNames(dir))('%s', (name) => {
    const r = parseSyncPage(PLATFORM[dir], fixture(dir, name))
    checkInvariants(r)
    expect(r).toMatchSnapshot()
  })
})

it('snapshot instagram media-info', () => {
  expect(parseInstagramMediaInfo(fixture('instagram', 'media-info.json'))).toMatchSnapshot()
})
