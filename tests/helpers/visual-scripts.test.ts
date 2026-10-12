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

describe('scènes', () => {
  it('13 scènes par défaut, ids uniques', () => {
    expect(START_SCENES).toHaveLength(13)
    expect(new Set(ALL_SCENES.map((s) => s.id)).size).toBe(ALL_SCENES.length)
  })

  it('selectScenes : défaut = scènes par défaut ; id inconnu refusé', () => {
    expect(selectScenes(undefined)).toHaveLength(13)
    expect(selectScenes(['palette']).map((s) => s.id)).toEqual(['palette'])
    expect(() => selectScenes(['nope'])).toThrow(/inconnue/)
  })
})

describe('shots : validation des arguments', () => {
  it('--library et --theme : valeurs connues acceptées, autres refusées avec message', () => {
    expect(libraryUsageError('demo')).toBeNull()
    expect(libraryUsageError('real')).toBeNull()
    expect(libraryUsageError('none')).toBeNull()
    expect(libraryUsageError('autre')).toMatch(/inconnu/)
    expect(themeUsageError('both')).toBeNull()
    expect(themeUsageError('sepia')).toMatch(/inconnu/)
  })

  it('refuse une source RECOLTOS_REAL_USERDATA vivante (Application Support), accepte une copie', () => {
    expect(realSourceRefusal('/Users/x/Library/Application Support/RecoltOS')).toMatch(/vivant/)
    expect(realSourceRefusal('/Users/x/Library/Application Support/Autre/copie')).toMatch(/vivant/)
    expect(realSourceRefusal('/tmp/recoltos-real-copie')).toBeNull()
  })

  it('shots : erreur d’usage en code 2 avec message français, sans pile', () => {
    const s = spawnSync(
      join(REPO_ROOT, 'node_modules/.bin/tsx'),
      ['--tsconfig', 'tsconfig.node.json', 'scripts/visual/shots.mts', '--library', 'foo'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    expect(s.status).toBe(2)
    expect(s.stderr).toContain('--library « foo » inconnu')
    expect(s.stderr).not.toContain('    at ')
  })
})

describe('manifeste des captures (shots)', () => {
  it('une relance partielle garde les scènes précédentes et remplace la scène relancée', () => {
    type Entry = { scene: string; theme: string; file: string | null; status: string }
    const before: Entry[] = [
      { scene: 'a', theme: 'light', file: '/x/a-light.png', status: 'ok' },
      { scene: 'b', theme: 'light', file: '/x/b-light.png', status: 'ok' },
      { scene: 'a', theme: 'dark', file: '/x/a-dark.png', status: 'ok' },
    ]
    const fresh: Entry[] = [{ scene: 'a', theme: 'light', file: null, status: 'erreur' }]
    expect(mergeManifest(before, fresh)).toEqual([
      { scene: 'a', theme: 'light', file: null, status: 'erreur' },
      { scene: 'b', theme: 'light', file: '/x/b-light.png', status: 'ok' },
      { scene: 'a', theme: 'dark', file: '/x/a-dark.png', status: 'ok' },
    ])
  })

  it('sans manifeste précédent, les résultats neufs sont repris tels quels', () => {
    const fresh = [{ scene: 'c', theme: 'dark', file: '/x/c.png', status: 'ok' }]
    expect(mergeManifest([], fresh)).toEqual(fresh)
  })
})
