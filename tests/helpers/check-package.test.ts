import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkPackage, PNPM_BUILTINS, type PackageJsonLike } from '../../scripts/check-package.mjs'
import { REPO_ROOT } from './paths'
import { makeTmpDir } from './tmpdir'

const real = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as PackageJsonLike
const clone = (): PackageJsonLike => structuredClone(real)

describe('checkPackage', () => {
  it('le package.json réel est conforme', () => {
    expect(checkPackage(real)).toEqual([])
  })

  it.each(['^1.2.3', '~1.2.3', '*', 'latest', '1.x', '>=1.0.0', '1.2', 'workspace:*'])(
    'refuse la version « %s »',
    (spec) => {
      const pkg = clone()
      pkg.devDependencies = { ...pkg.devDependencies, zod: spec }
      const errors = checkPackage(pkg)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('devDependencies.zod')
    },
  )

  it('accepte les préversions et métadonnées exactes', () => {
    const pkg = clone()
    pkg.devDependencies = { ...pkg.devDependencies, a: '1.0.0-rc.1', b: '2.3.4+build.5' }
    expect(checkPackage(pkg)).toEqual([])
  })

  it('refuse une dépendance d’exécution hors liste blanche', () => {
    const pkg = clone()
    pkg.dependencies = { ...pkg.dependencies, zod: '4.6.5' }
    expect(checkPackage(pkg).join('\n')).toContain('dependencies.zod : hors liste blanche')
  })

  it('refuse une collision avec une commande intégrée de pnpm, sauf « pack »', () => {
    expect(PNPM_BUILTINS).toContain('doctor')
    const pkg = clone()
    pkg.scripts = { ...pkg.scripts, doctor: 'x', rebuild: 'y' }
    const errors = checkPackage(pkg)
    expect(errors).toHaveLength(2)
    expect(checkPackage({ ...real, scripts: { pack: 'electron-builder' } })).toEqual([])
  })

  it('refuse un autre packageManager et "type": "module"', () => {
    expect(checkPackage({ ...real, packageManager: 'pnpm@9.15.0+sha512.76e2' })).toHaveLength(1)
    expect(checkPackage({ ...real, packageManager: undefined })).toHaveLength(1)
    expect(checkPackage({ ...real, type: 'module' })[0]).toContain('"type": "module"')
  })
})

describe('check:pkg (CLI)', () => {
  const cli = (file: string) =>
    spawnSync(
      join(REPO_ROOT, 'node_modules/.bin/tsx'),
      ['--tsconfig', 'tsconfig.node.json', 'scripts/check-package.mts', '--file', file],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )

  it('sort 0 sur le package.json réel et 1 quand un « ^ » est introduit', () => {
    expect(cli(join(REPO_ROOT, 'package.json')).status).toBe(0)
    const dir = makeTmpDir('pkg')
    const bad = clone()
    bad.devDependencies = { ...bad.devDependencies, zod: '^4.6.5' }
    const file = join(dir, 'package.json')
    writeFileSync(file, JSON.stringify(bad))
    const r = cli(file)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('devDependencies.zod')
    expect(r.stderr).toContain('^4.6.5')
  })
})
