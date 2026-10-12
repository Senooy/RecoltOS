import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: {},
  ipcMain: {},
  nativeTheme: {},
  screen: {},
}))

import { BG_DARK, BG_LIGHT, followNativeTheme } from '../../../src/main/windows/main-window'

describe('window background and system appearance', () => {
  it('follows nativeTheme "updated" and detaches', () => {
    let listener: (() => void) | undefined
    const theme = {
      shouldUseDarkColors: true,
      on: vi.fn((_e: string, l: () => void) => {
        listener = l
      }),
      removeListener: vi.fn(),
    }
    const win = { isDestroyed: () => false, setBackgroundColor: vi.fn() }
    const stop = followNativeTheme(win, theme as never)
    listener?.()
    expect(win.setBackgroundColor).toHaveBeenLastCalledWith(BG_DARK)
    theme.shouldUseDarkColors = false
    listener?.()
    expect(win.setBackgroundColor).toHaveBeenLastCalledWith(BG_LIGHT)
    stop()
    expect(theme.removeListener).toHaveBeenCalledWith('updated', listener)
  })

  it('ignores a destroyed window', () => {
    let listener: (() => void) | undefined
    const theme = {
      shouldUseDarkColors: true,
      on: (_e: string, l: () => void) => {
        listener = l
      },
      removeListener: vi.fn(),
    }
    const win = { isDestroyed: () => true, setBackgroundColor: vi.fn() }
    followNativeTheme(win, theme as never)
    listener?.()
    expect(win.setBackgroundColor).not.toHaveBeenCalled()
  })
})
