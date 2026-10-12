/**
 * Synthetic sync fixtures: deterministic and secret-free.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cosmosFixtures,
  igFixtures,
  xBundleFixtures,
  xFixtures,
  xWebFixtures,
} from '../../../scripts/make-sync-fixtures.mjs'

const DIR = join(import.meta.dirname, '../../fixtures/sync')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

describe('sync fixtures', () => {
  it('contain no cookie nor token (ct0, sessionid, Bearer)', () => {
    for (const f of walk(DIR)) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/ct0|sessionid|Bearer/)
    }
  })

  it('are up to date with the generator', () => {
    const groups: [string, Record<string, unknown>][] = [
      ['x', xFixtures()],
      ['x/bundle', xBundleFixtures()],
      ['x/xweb', xWebFixtures()],
      ['instagram', igFixtures()],
      ['cosmos', cosmosFixtures()],
    ]
    for (const [dir, files] of groups) {
      for (const [name, data] of Object.entries(files)) {
        const expected = typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`
        expect(readFileSync(join(DIR, dir, name), 'utf8'), `${dir}/${name}`).toBe(expected)
      }
    }
  })

  it('cover the expected cases', () => {
    const names = walk(DIR).map((p) => p.slice(DIR.length + 1))
    for (const n of [
      'x/simple.json',
      'x/medias-multiples.json',
      'x/cite.json',
      'x/fil.json',
      'x/note-tweet.json',
      'x/visibilite.json',
      'x/tombstone.json',
      'x/video.json',
      'x/curseur-page1.json',
      'instagram/image.json',
      'instagram/reel.json',
      'instagram/carrousel.json',
      'instagram/page-1.json',
      'cosmos/image.json',
      'cosmos/lien.json',
      'cosmos/page-1.json',
    ]) {
      expect(names).toContain(n)
    }
  })
})
