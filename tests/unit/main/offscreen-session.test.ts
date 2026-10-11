import { beforeEach, describe, expect, it, vi } from 'vitest'

const sessions = new Map<string, { name: string; on: () => void; [k: string]: unknown }>()
vi.mock('electron', () => ({
  BrowserWindow: class {},
  session: {
    fromPartition: (name: string) => {
      let s = sessions.get(name)
      if (!s) {
        s = {
          name,
          on: () => undefined,
          setPermissionRequestHandler: () => undefined,
          setPermissionCheckHandler: () => undefined,
        }
        sessions.set(name, s)
      }
      return s
    },
  },
}))

import {
  acquirePartition,
  registerOffscreenSessionSetup,
  resetOffscreenForTests,
} from '../../../src/main/windows/offscreen'

describe('configuration des sessions hors écran', () => {
  beforeEach(() => {
    sessions.clear()
    resetOffscreenForTests()
  })

  it('appelle le point d’accroche sur chaque nouvelle partition', () => {
    const fn = vi.fn()
    registerOffscreenSessionSetup(fn)
    const p1 = acquirePartition()
    const p2 = acquirePartition()
    expect(p1).toBe('recolt-offscreen-1')
    expect(p2).toBe('recolt-offscreen-2')
    expect(fn.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual([p1, p2])
  })

  it('applique aussi la configuration aux partitions déjà créées', () => {
    const p1 = acquirePartition()
    const fn = vi.fn()
    registerOffscreenSessionSetup(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect((fn.mock.calls[0]?.[0] as { name: string }).name).toBe(p1)
  })
})
