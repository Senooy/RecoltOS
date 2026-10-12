import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkPackage,
  checkWorkspace,
  PNPM_BUILTINS,
  type PackageJsonLike,
} from '../../scripts/check-package.mjs'
import { REPO_ROOT } from './paths'
import { makeTmpDir } from './tmpdir'

const real = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as PackageJsonLike
const clone = (): PackageJsonLike => structuredClone(real)

describe('checkPackage', () => {
  it('the real package.json is compliant', () => {
    expect(checkPackage(real)).toEqual([])
  })

  it.each(['^1.2.3', '~1.2.3', '*', 'latest', '1.x', '>=1.0.0', '1.2', 'workspace:*'])(
    'rejects version "%s"',
    (spec) => {
      const pkg = clone()
      pkg.devDependencies = { ...pkg.devDependencies, zod: spec }
      const errors = checkPackage(pkg)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('devDependencies.zod')
    },
  )

  it('accepts prereleases and exact metadata', () => {
    const pkg = clone()
    pkg.devDependencies = { ...pkg.devDependencies, a: '1.0.0-rc.1', b: '2.3.4+build.5' }
    expect(checkPackage(pkg)).toEqual([])
  })

  it('rejects a runtime dependency not on the allowlist', () => {
    const pkg = clone()
    pkg.dependencies = { ...pkg.dependencies, zod: '4.6.5' }
    expect(checkPackage(pkg).join('\n')).toContain('dependencies.zod: not in the allowlist')
  })

  it('rejects a clash with a built-in pnpm command, except « pack »', () => {
    expect(PNPM_BUILTINS).toContain('doctor')
    const pkg = clone()
    pkg.scripts = { ...pkg.scripts, doctor: 'x', rebuild: 'y' }
    const errors = checkPackage(pkg)
    expect(errors).toHaveLength(2)
    expect(checkPackage({ ...real, scripts: { pack: 'electron-builder' } })).toEqual([])
  })

  it('rejects another packageManager and "type": "module"', () => {
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

  it('exits 0 on the real package.json and 1 when a « ^ » is introduced', () => {
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

describe('check:pkg: overrides and CLI entry', () => {
  it.each([
    ['overrides', { overrides: { zod: '^4.6.5' } }],
    ['overrides', { overrides: { zod: '4.6.5 || 4.6.4' } }],
    ['pnpm.overrides', { pnpm: { overrides: { zod: '~4.6.5' } } }],
    ['overrides', { overrides: { zod: { '.': '4.6.5' } } }],
  ])('rejects a non-exact version in %s', (label, extra) => {
    const errors = checkPackage({ ...clone(), ...extra })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(`${label}.zod`)
  })

  it('accepts exact overrides (npm and pnpm)', () => {
    expect(
      checkPackage({
        ...clone(),
        overrides: { zod: '4.6.5' },
        pnpm: { overrides: { zod: '4.6.5' } },
      }),
    ).toEqual([])
  })

  const cli = (args: string[]) =>
    spawnSync(
      join(REPO_ROOT, 'node_modules/.bin/tsx'),
      ['--tsconfig', 'tsconfig.node.json', 'scripts/check-package.mts', ...args],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )

  it('missing file or invalid JSON: exit 1 with a message, no stack trace', () => {
    const dir = makeTmpDir('pkg-missing')
    const absent = cli(['--file', join(dir, 'missing.json')])
    expect(absent.status).toBe(1)
    expect(absent.stderr).toContain('cannot read')
    expect(absent.stderr).not.toContain('    at ')

    const broken = join(dir, 'broken.json')
    writeFileSync(broken, '{ "name": ')
    const r = cli(['--file', broken])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('cannot read')
    expect(r.stderr).not.toContain('    at ')
  })

  it('--file without a value: rejected (exit 2), no silent fallback to package.json', () => {
    const r = cli(['--file'])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('--file requires a path')
    expect(r.stdout).toBe('')
    expect(cli(['--file', '--autre']).status).toBe(2)
  })
})

describe('check:pkg: pnpm-workspace.yaml (overrides, catalog, catalogs)', () => {
  const cli = (file: string) =>
    spawnSync(
      join(REPO_ROOT, 'node_modules/.bin/tsx'),
      ['--tsconfig', 'tsconfig.node.json', 'scripts/check-package.mts', '--file', file],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )

  it('the real pnpm-workspace.yaml is compliant', () => {
    expect(checkWorkspace(readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8'))).toEqual([])
  })

  it('rejects a « ^ » under overrides and catalog', () => {
    const o = checkWorkspace('overrides:\n  zod: ^4.6.5\n')
    expect(o).toHaveLength(1)
    expect(o[0]).toContain('overrides.zod')
    const c = checkWorkspace('catalog:\n  react: ^19.2.0\n')
    expect(c).toHaveLength(1)
    expect(c[0]).toContain('catalog.react')
  })

  it('rejects a range under catalogs.<name>, accepts exact versions', () => {
    const text = "catalogs:\n  default:\n    zod: 4.6.5\n    react: '~19.2.0'\n"
    const errors = checkWorkspace(text)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('catalogs.default.react')
  })

  it('fails closed on an unparseable shape in a controlled section', () => {
    const errors = checkWorkspace('overrides:\n  - zod\n')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain('pnpm-workspace.yaml line')
  })

  it('ignores other settings (lists, allowBuilds) outside the controlled section', () => {
    expect(
      checkWorkspace(
        'supportedArchitectures:\n  cpu:\n    - arm64\nallowBuilds:\n  electron: true\n',
      ),
    ).toEqual([])
  })

  it('CLI: a « ^ » in a neighboring pnpm-workspace.yaml makes check:pkg fail', () => {
    const dir = makeTmpDir('pkg-ws')
    writeFileSync(join(dir, 'package.json'), JSON.stringify(clone()))
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'overrides:\n  zod: ^4.6.5\n')
    const r = cli(join(dir, 'package.json'))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('overrides.zod')
  })
})
