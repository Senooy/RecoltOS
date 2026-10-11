import { describe, expect, it } from 'vitest'
import {
  checkNativesInNode,
  checkNodeVersion,
  checkPackageManager,
  checkPlatform,
  findExecutable,
  parsePnpmUserAgent,
} from '../../scripts/check-env.mjs'
import { REPO_ROOT } from './paths'

describe('check:env', () => {
  it('lit la version de pnpm dans le user agent', () => {
    expect(parsePnpmUserAgent('pnpm/12.6.0 npm/? node/v22.22.3 darwin arm64')).toBe('12.6.0')
    expect(parsePnpmUserAgent('pnpm/9.15.0 npm/? node/v22 darwin arm64')).toBe('9.15.0')
    expect(parsePnpmUserAgent('npm/10.9.8 node/v22')).toBeNull()
    expect(parsePnpmUserAgent(undefined)).toBeNull()
  })

  it('pnpm/12.6.0 est ok ; pnpm/9.15.0 AVERTIT (jamais ne bloque)', () => {
    expect(checkPackageManager('pnpm/12.6.0 npm/? node/v22').level).toBe('ok')
    const legacy = checkPackageManager('pnpm/9.15.0 npm/? node/v22', ['/opt/homebrew/bin/pnpm'])
    expect(legacy.level).toBe('warn')
    expect(legacy.detail).toContain('pnpm/9.15.0')
    expect(legacy.detail).toContain('pnpm/12.6.0')
    expect(legacy.detail).toContain('/opt/homebrew/bin/pnpm')
    expect(checkPackageManager('').level).toBe('warn')
    expect(checkPackageManager('pnpm/10.0.0 npm/?').level).toBe('warn')
  })

  it('Node 22 et 24 acceptés, autres refusés', () => {
    expect(checkNodeVersion({ node: '22.22.3' }).level).toBe('ok')
    expect(checkNodeVersion({ node: '24.21.0' }).level).toBe('ok')
    expect(checkNodeVersion({ node: '20.11.0' }).level).toBe('fail')
    expect(checkNodeVersion({ node: '26.0.0' }).level).toBe('fail')
  })

  it('macOS arm64 uniquement', () => {
    expect(checkPlatform('darwin', 'arm64').level).toBe('ok')
    expect(checkPlatform('darwin', 'x64').level).toBe('fail')
    expect(checkPlatform('linux', 'arm64').level).toBe('fail')
  })

  it('better-sqlite3, FTS5 et sharp se chargent sous Node', () => {
    const c = checkNativesInNode(REPO_ROOT)
    expect(c.detail).toContain('FTS5')
    expect(c.level).toBe('ok')
  })

  it('trouve un exécutable système, pas un inconnu', () => {
    expect(findExecutable('sh', ['/bin'])).toBe('/bin/sh')
    expect(findExecutable('recoltos-inexistant', ['/bin', '/usr/bin'])).toBeNull()
  })
})
