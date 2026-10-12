import { describe, expect, it } from 'vitest'
import { DEFAULT_WINDOW, parseWindowSize, readFlags } from '../../../src/main/bootstrap/env'
import { filesFromArgv, onOpenFiles, queueOpenFiles } from '../../../src/main/bootstrap/open-files'
import { parseWindowState, pickRestoreBounds } from '../../../src/main/windows/window-state'

const display = { id: 1, workArea: { x: 0, y: 25, width: 1512, height: 957 } }

describe('environment flags', () => {
  it('RECOLTOS_E2E sets 1280×820 by default', () => {
    expect(readFlags({ RECOLTOS_E2E: '1' }).windowSize).toEqual(DEFAULT_WINDOW)
    expect(readFlags({}).windowSize).toBeNull()
    expect(readFlags({ RECOLTOS_WINDOW: '1440x900' }).windowSize).toEqual({
      width: 1440,
      height: 900,
    })
  })
  it('parseWindowSize clamps to a minimum of 1040×620', () => {
    expect(parseWindowSize('800x500')).toEqual({ width: 1040, height: 620 })
    expect(parseWindowSize('abc')).toBeNull()
  })
})

describe('window-state', () => {
  const state = parseWindowState({ bounds: { x: 120, y: 90, width: 1100, height: 700 } })
  it('restores visible bounds', () => {
    expect(state).not.toBeNull()
    expect(pickRestoreBounds(state, [display])).toEqual({
      bounds: { x: 120, y: 90, width: 1100, height: 700 },
      maximize: false,
      fullScreen: false,
    })
  })
  it('display unplugged: back to centered 1280×820, without reusing the saved size', () => {
    const off = parseWindowState({
      bounds: { x: 5000, y: 90, width: 1100, height: 700 },
      isMaximized: true,
    })
    expect(pickRestoreBounds(off, [display])).toEqual({
      bounds: DEFAULT_WINDOW,
      maximize: false,
      fullScreen: false,
    })
  })
  it('absurd off-screen state (x:-90000, 99999 px): 1280×820, not the screen width', () => {
    const wild = parseWindowState({ bounds: { x: -90000, y: 0, width: 99999, height: 200 } })
    expect(pickRestoreBounds(wild, [display]).bounds).toEqual(DEFAULT_WINDOW)
  })
  it('large external display unplugged: no giant window on the current screen', () => {
    const external = { id: 2, workArea: { x: 1512, y: 25, width: 2560, height: 1400 } }
    const big = parseWindowState({ bounds: { x: 1600, y: 100, width: 2400, height: 1300 } })
    expect(pickRestoreBounds(big, [display]).bounds).toEqual(DEFAULT_WINDOW)
    expect(pickRestoreBounds(big, [display, external]).bounds).toMatchObject({ width: 2400 })
  })
  it('size capped to the visible display workArea', () => {
    const shrunk = parseWindowState({ bounds: { x: 0, y: 25, width: 1800, height: 1100 } })
    expect(pickRestoreBounds(shrunk, [display]).bounds).toMatchObject({
      x: 0,
      y: 25,
      width: 1512,
      height: 957,
    })
  })
  it('restores the saved fullscreen state', () => {
    const fs = parseWindowState({
      bounds: { x: 120, y: 90, width: 1100, height: 700 },
      isFullScreen: true,
    })
    expect(pickRestoreBounds(fs, [display]).fullScreen).toBe(true)
  })
  it('missing or invalid file: 1280×820', () => {
    expect(pickRestoreBounds(null, [display])).toEqual({
      bounds: DEFAULT_WINDOW,
      maximize: false,
      fullScreen: false,
    })
    expect(parseWindowState({ bounds: { x: 'a' } })).toBeNull()
  })
  it('never below the minimum size', () => {
    const tiny = parseWindowState({ bounds: { x: 10, y: 40, width: 300, height: 200 } })
    expect(pickRestoreBounds(tiny, [display]).bounds).toMatchObject({ width: 1040, height: 620 })
  })
})

describe('open-file', () => {
  it('queues then delivers to the consumer', () => {
    queueOpenFiles(['/a.png', 'relatif.png'])
    const got: string[][] = []
    const off = onOpenFiles((p) => got.push(p))
    queueOpenFiles(['/b.png'])
    off()
    expect(got).toEqual([['/a.png'], ['/b.png']])
    expect(filesFromArgv(['/Applications/RecoltOS.app/x', '--flag', '/c.jpg'])).toEqual(['/c.jpg'])
  })

  it('ignores the script entry, the app folder and its contents in a second-instance argv', () => {
    const app = '/Users/me/RecoltOS'
    const argv = [
      '/usr/bin/electron',
      '/Users/me/RecoltOS/out/main/index.js',
      '/Users/me/RecoltOS',
      '/Users/me/RecoltOS/docs/a.png',
      '/Users/me/Photos/b.jpg',
      '/Users/me/RecoltOSbis/c.jpg',
    ]
    expect(filesFromArgv(argv, { appPath: app })).toEqual([
      '/Users/me/Photos/b.jpg',
      '/Users/me/RecoltOSbis/c.jpg',
    ])
    expect(filesFromArgv(['/exe', '/abs/autre/index.cjs', '/d.png'])).toEqual(['/d.png'])
  })
})
