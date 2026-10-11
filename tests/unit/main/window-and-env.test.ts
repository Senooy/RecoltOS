import { describe, expect, it } from 'vitest'
import { DEFAULT_WINDOW, parseWindowSize, readFlags } from '../../../src/main/bootstrap/env'
import { filesFromArgv, onOpenFiles, queueOpenFiles } from '../../../src/main/bootstrap/open-files'
import { parseWindowState, pickRestoreBounds } from '../../../src/main/windows/window-state'

const display = { id: 1, workArea: { x: 0, y: 25, width: 1512, height: 957 } }

describe('flags d’environnement (QA §2)', () => {
  it('RECOLTOS_E2E impose 1280×820 par défaut', () => {
    expect(readFlags({ RECOLTOS_E2E: '1' }).windowSize).toEqual(DEFAULT_WINDOW)
    expect(readFlags({}).windowSize).toBeNull()
    expect(readFlags({ RECOLTOS_WINDOW: '1440x900' }).windowSize).toEqual({
      width: 1440,
      height: 900,
    })
  })
  it('parseWindowSize borne au minimum 1040×620', () => {
    expect(parseWindowSize('800x500')).toEqual({ width: 1040, height: 620 })
    expect(parseWindowSize('abc')).toBeNull()
  })
})

describe('window-state', () => {
  const state = parseWindowState({ bounds: { x: 120, y: 90, width: 1100, height: 700 } })
  it('restaure des bornes visibles', () => {
    expect(state).not.toBeNull()
    expect(pickRestoreBounds(state, [display])).toEqual({
      bounds: { x: 120, y: 90, width: 1100, height: 700 },
      maximize: false,
    })
  })
  it('écran débranché : garde la taille, oublie la position', () => {
    const off = parseWindowState({
      bounds: { x: 5000, y: 90, width: 1100, height: 700 },
      isMaximized: true,
    })
    expect(pickRestoreBounds(off, [display])).toEqual({
      bounds: { width: 1100, height: 700 },
      maximize: true,
    })
  })
  it('fichier absent ou invalide : 1280×820', () => {
    expect(pickRestoreBounds(null, [display])).toEqual({ bounds: DEFAULT_WINDOW, maximize: false })
    expect(parseWindowState({ bounds: { x: 'a' } })).toBeNull()
  })
  it('jamais sous la taille minimale', () => {
    const tiny = parseWindowState({ bounds: { x: 10, y: 40, width: 300, height: 200 } })
    expect(pickRestoreBounds(tiny, [display]).bounds).toMatchObject({ width: 1040, height: 620 })
  })
})

describe('open-file', () => {
  it('met en attente puis livre au consommateur', () => {
    queueOpenFiles(['/a.png', 'relatif.png'])
    const got: string[][] = []
    const off = onOpenFiles((p) => got.push(p))
    queueOpenFiles(['/b.png'])
    off()
    expect(got).toEqual([['/a.png'], ['/b.png']])
    expect(filesFromArgv(['/Applications/RecoltOS.app/x', '--flag', '/c.jpg'])).toEqual(['/c.jpg'])
  })
})
