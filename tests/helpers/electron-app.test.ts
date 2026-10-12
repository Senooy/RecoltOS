/**
 * `buildLaunchEnv`: the env of the launched Electron app must never inherit ELECTRON_RUN_AS_NODE
 * (nor the other variables of INHERITED_ELECTRON_ENV_TO_DROP), even under a terminal that
 * sets them.
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

  it('removes inherited variables (absent, not empty)', () => {
    const env = buildLaunchEnv(inherited, { RECOLTOS_E2E: '1' })
    for (const key of INHERITED_ELECTRON_ENV_TO_DROP) expect(key in env).toBe(false)
    expect(env.PATH).toBe('/usr/bin')
    expect(env.RECOLTOS_E2E).toBe('1')
    expect('UNDEFINED_VALUE' in env).toBe(false)
  })

  it('leaves the last word to the caller (explicit option)', () => {
    const env = buildLaunchEnv(inherited, { RECOLTOS_E2E: '1' }, { RECOLTOS_E2E: '0' })
    expect(env.RECOLTOS_E2E).toBe('0')
  })
})
