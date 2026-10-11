/** WP-24 : l'instantané quotidien est planifié pour la bibliothèque déjà ouverte au démarrage. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initData, DAILY_DELAY_MS } from '../../../src/main/data/init'
import * as snapshots from '../../../src/main/data/snapshots'
import {
  resetLibraryContextForTests,
  setActiveLibrary,
  type LibraryContext,
} from '../../../src/main/library/library-context'
import type { ServiceContext } from '../../../src/main/bootstrap/context'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetLibraryContextForTests()
})

const ctx = (e2e: boolean) =>
  ({
    flags: { e2e },
    log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  }) as unknown as ServiceContext

describe('initData', () => {
  it('bibliothèque active au démarrage : instantané quotidien après le délai', () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(snapshots, 'dailySnapshot').mockReturnValue(null)
    setActiveLibrary({ id: 'default' } as LibraryContext)
    const dispose = initData(ctx(false))
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(DAILY_DELAY_MS + 1)
    expect(spy).toHaveBeenCalledTimes(1)
    void dispose()
  })
  it('jamais en e2e', () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(snapshots, 'dailySnapshot').mockReturnValue(null)
    setActiveLibrary({ id: 'default' } as LibraryContext)
    const dispose = initData(ctx(true))
    vi.advanceTimersByTime(DAILY_DELAY_MS * 2)
    expect(spy).not.toHaveBeenCalled()
    void dispose()
  })
})
