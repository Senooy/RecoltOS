/**
 * `buildLaunchEnv` : l'env de l'app Electron lancée ne doit jamais hériter de ELECTRON_RUN_AS_NODE
 * (ni des autres variables de INHERITED_ELECTRON_ENV_TO_DROP), même sous un terminal qui les pose.
 */
import { describe, expect, it } from 'vitest'
import { buildLaunchEnv, INHERITED_ELECTRON_ENV_TO_DROP } from './electron-app'

describe('buildLaunchEnv', () => {
  const inherited = {
    PATH: '/usr/bin',
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    NODE_OPTIONS: '--inspect',
    ELECTRON_RENDERER_URL: 'http://localhost:5173',
    UNDEFINED_VALUE: undefined,
  } as NodeJS.ProcessEnv

  it('retire les variables héritées (absentes, pas vides)', () => {
    const env = buildLaunchEnv(inherited, { RECOLTOS_E2E: '1' })
    for (const key of INHERITED_ELECTRON_ENV_TO_DROP) expect(key in env).toBe(false)
    expect(env.PATH).toBe('/usr/bin')
    expect(env.RECOLTOS_E2E).toBe('1')
    expect('UNDEFINED_VALUE' in env).toBe(false)
  })

  it("laisse à l'appelant le dernier mot (option explicite)", () => {
    const env = buildLaunchEnv(inherited, { RECOLTOS_E2E: '1' }, { RECOLTOS_E2E: '0' })
    expect(env.RECOLTOS_E2E).toBe('0')
  })
})
