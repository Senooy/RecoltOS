import { existsSync, mkdirSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TMP_ROOT } from './paths'
import { makeTmpDir, purgeStaleTmpDirs, removeAllTmpDirs, removeTmpDir } from './tmpdir'

describe('tmpdir', () => {
  it('removeAllTmpDirs supprime tout ce que le processus a créé (hook afterAll de tests/setup/node.ts)', () => {
    const a = makeTmpDir('all-a')
    const b = makeTmpDir('all-b')
    expect(existsSync(a) && existsSync(b)).toBe(true)
    removeAllTmpDirs()
    expect(existsSync(a) || existsSync(b)).toBe(false)
  })

  it('removeTmpDir supprime un dossier précis', () => {
    const a = makeTmpDir('one')
    removeTmpDir(a)
    expect(existsSync(a)).toBe(false)
  })

  it('purgeStaleTmpDirs ne supprime que les dossiers anciens', () => {
    const fresh = makeTmpDir('fresh')
    const old = join(TMP_ROOT, 'tests', `stale-${process.pid}`)
    mkdirSync(old, { recursive: true })
    const past = new Date(Date.now() - 3_600_000)
    utimesSync(old, past, past)
    expect(purgeStaleTmpDirs()).toBeGreaterThanOrEqual(1)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
  })
})
