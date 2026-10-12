import { describe, expect, it } from 'vitest'
import { DEFAULT_WINDOW, parseWindowSize, readFlags } from '../../../src/main/bootstrap/env'
import { filesFromArgv, onOpenFiles, queueOpenFiles } from '../../../src/main/bootstrap/open-files'
import { parseWindowState, pickRestoreBounds } from '../../../src/main/windows/window-state'

const display = { id: 1, workArea: { x: 0, y: 25, width: 1512, height: 957 } }

describe('flags d’environnement', () => {
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
      fullScreen: false,
    })
  })
  it('écran débranché : revient à 1280×820 centrée, sans reprendre la taille sauvegardée', () => {
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
  it('état hors écran absurde (x:-90000, 99999 px) : 1280×820 et non la largeur de l’écran', () => {
    const wild = parseWindowState({ bounds: { x: -90000, y: 0, width: 99999, height: 200 } })
    expect(pickRestoreBounds(wild, [display]).bounds).toEqual(DEFAULT_WINDOW)
  })
  it('grand écran externe débranché : pas de fenêtre géante sur l’écran courant', () => {
    const external = { id: 2, workArea: { x: 1512, y: 25, width: 2560, height: 1400 } }
    const big = parseWindowState({ bounds: { x: 1600, y: 100, width: 2400, height: 1300 } })
    expect(pickRestoreBounds(big, [display]).bounds).toEqual(DEFAULT_WINDOW)
    expect(pickRestoreBounds(big, [display, external]).bounds).toMatchObject({ width: 2400 })
  })
  it('taille bornée à la workArea de l’écran visible', () => {
    const shrunk = parseWindowState({ bounds: { x: 0, y: 25, width: 1800, height: 1100 } })
    expect(pickRestoreBounds(shrunk, [display]).bounds).toMatchObject({
      x: 0,
      y: 25,
      width: 1512,
      height: 957,
    })
  })
  it('restaure le plein écran sauvegardé', () => {
    const fs = parseWindowState({
      bounds: { x: 120, y: 90, width: 1100, height: 700 },
      isFullScreen: true,
    })
    expect(pickRestoreBounds(fs, [display]).fullScreen).toBe(true)
  })
  it('fichier absent ou invalide : 1280×820', () => {
    expect(pickRestoreBounds(null, [display])).toEqual({
      bounds: DEFAULT_WINDOW,
      maximize: false,
      fullScreen: false,
    })
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

  it('ignore l’entrée de script, le dossier de l’app et ses contenus dans un argv de seconde instance', () => {
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
