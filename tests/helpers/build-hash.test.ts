import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { computeBuildHash, listBuildInputs } from './build-hash'
import { REPO_ROOT } from './paths'
import { makeTmpDir } from './tmpdir'

function project(): string {
  const dir = makeTmpDir('hash')
  mkdirSync(join(dir, 'src/main'), { recursive: true })
  mkdirSync(join(dir, 'extension'), { recursive: true })
  writeFileSync(join(dir, 'src/main/index.ts'), 'a')
  writeFileSync(join(dir, 'package.json'), '{}')
  return dir
}

describe('build-hash', () => {
  it('stable, et sensible au contenu, aux nouveaux fichiers et à package.json', () => {
    const dir = project()
    const h0 = computeBuildHash(dir)
    expect(computeBuildHash(dir)).toBe(h0)
    writeFileSync(join(dir, 'src/main/index.ts'), 'b')
    const h1 = computeBuildHash(dir)
    expect(h1).not.toBe(h0)
    writeFileSync(join(dir, 'extension/manifest.json'), '{}')
    const h2 = computeBuildHash(dir)
    expect(h2).not.toBe(h1)
    writeFileSync(join(dir, 'package.json'), '{"a":1}')
    expect(computeBuildHash(dir)).not.toBe(h2)
  })

  it('ignore out/, node_modules et les tests (pas de rebuild pour un spec)', () => {
    const dir = project()
    const h0 = computeBuildHash(dir)
    mkdirSync(join(dir, 'out'), { recursive: true })
    mkdirSync(join(dir, 'tests'), { recursive: true })
    writeFileSync(join(dir, 'out/x.js'), 'x')
    writeFileSync(join(dir, 'tests/a.spec.ts'), 'x')
    expect(computeBuildHash(dir)).toBe(h0)
  })

  it('couvre les sources réelles', () => {
    const files = listBuildInputs(REPO_ROOT)
    expect(files.some((f) => f.endsWith('src/main/index.ts'))).toBe(true)
    expect(files.some((f) => f.endsWith('electron.vite.config.ts'))).toBe(true)
  })
})
