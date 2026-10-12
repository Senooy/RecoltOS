import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from './paths'
import { mergeManifest } from '../../scripts/visual/manifest.mjs'
import { ALL_SCENES, START_SCENES, selectScenes } from '../../scripts/visual/scenes.mjs'
import {
  libraryUsageError,
  realSourceRefusal,
  themeUsageError,
} from '../../scripts/visual/shots.mjs'

describe('scenes', () => {
  it('13 default scenes, unique ids', () => {
    expect(START_SCENES).toHaveLength(13)
    expect(new Set(ALL_SCENES.map((s) => s.id)).size).toBe(ALL_SCENES.length)
  })

  it('selectScenes: default = default scenes; unknown id refused', () => {
    expect(selectScenes(undefined)).toHaveLength(13)
    expect(selectScenes(['palette']).map((s) => s.id)).toEqual(['palette'])
    expect(() => selectScenes(['nope'])).toThrow(/unknown scene/)
  })
})

describe('shots: argument validation', () => {
  it('--library and --theme: known values accepted, others refused with a message', () => {
    expect(libraryUsageError('demo')).toBeNull()
    expect(libraryUsageError('real')).toBeNull()
    expect(libraryUsageError('none')).toBeNull()
    expect(libraryUsageError('other')).toMatch(/unknown/)
    expect(themeUsageError('both')).toBeNull()
    expect(themeUsageError('sepia')).toMatch(/unknown/)
  })

  it('refuses a live RECOLTOS_REAL_USERDATA source (Application Support), accepts a copy', () => {
    expect(realSourceRefusal('/Users/x/Library/Application Support/RecoltOS')).toMatch(
      /live data folder/,
    )
    expect(realSourceRefusal('/Users/x/Library/Application Support/Autre/copie')).toMatch(
      /live data folder/,
    )
    expect(realSourceRefusal('/tmp/recoltos-real-copie')).toBeNull()
  })

  it('shots: usage error with exit code 2 and a French message, no stack trace', () => {
    const s = spawnSync(
      join(REPO_ROOT, 'node_modules/.bin/tsx'),
      ['--tsconfig', 'tsconfig.node.json', 'scripts/visual/shots.mts', '--library', 'foo'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    expect(s.status).toBe(2)
    expect(s.stderr).toContain('unknown --library "foo"')
    expect(s.stderr).not.toContain('    at ')
  })
})

describe('capture manifest (shots)', () => {
  it('a partial re-run keeps the previous scenes and replaces the re-run scene', () => {
    type Entry = { scene: string; theme: string; file: string | null; status: string }
    const before: Entry[] = [
      { scene: 'a', theme: 'light', file: '/x/a-light.png', status: 'ok' },
      { scene: 'b', theme: 'light', file: '/x/b-light.png', status: 'ok' },
      { scene: 'a', theme: 'dark', file: '/x/a-dark.png', status: 'ok' },
    ]
    const fresh: Entry[] = [{ scene: 'a', theme: 'light', file: null, status: 'error' }]
    expect(mergeManifest(before, fresh)).toEqual([
      { scene: 'a', theme: 'light', file: null, status: 'error' },
      { scene: 'b', theme: 'light', file: '/x/b-light.png', status: 'ok' },
      { scene: 'a', theme: 'dark', file: '/x/a-dark.png', status: 'ok' },
    ])
  })

  it('without a previous manifest, new results are kept as they are', () => {
    const fresh = [{ scene: 'c', theme: 'dark', file: '/x/c.png', status: 'ok' }]
    expect(mergeManifest([], fresh)).toEqual(fresh)
  })
})
