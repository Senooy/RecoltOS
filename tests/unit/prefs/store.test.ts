import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ nativeTheme: { themeSource: 'system' } }))
vi.mock('electron', () => electron)

import { DEFAULT_PREFS } from '../../../src/shared/prefs'
import { dispatch } from '../../../src/main/ipc/router'
import { prefsHandlers } from '../../../src/main/ipc/handlers/prefs'
import { initPrefs } from '../../../src/main/prefs/init'
import {
  createPrefsStore,
  getPrefsStore,
  requirePrefsStore,
  setPrefsStore,
} from '../../../src/main/prefs/store'
import type { ServiceContext } from '../../../src/main/bootstrap/context'

let dir: string
let file: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recolt-prefs-'))
  file = path.join(dir, 'prefs.json')
})
afterEach(() => {
  setPrefsStore(null)
  fs.rmSync(dir, { recursive: true, force: true })
})

const onDisk = () => JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>

describe('prefs/store', () => {
  it('fichier absent : défauts ; patch profond écrit atomiquement et notifie', () => {
    const store = createPrefsStore({ file })
    expect(store.get()).toEqual(DEFAULT_PREFS)
    expect(fs.existsSync(file)).toBe(false)
    const listener = vi.fn()
    const off = store.onChange(listener)
    const next = store.set({ theme: 'dark', capture: { notify: false } })
    expect(next.theme).toBe('dark')
    expect(next.capture.shortcut).toBe('CommandOrControl+Shift+S')
    expect(next.capture.notify).toBe(false)
    expect(onDisk()).toEqual(next)
    expect(fs.existsSync(`${file}.tmp`)).toBe(false)
    expect(listener).toHaveBeenCalledWith(next, DEFAULT_PREFS)
    // Patch sans effet : ni écriture ni notification.
    const mtime = fs.statSync(file).mtimeMs
    expect(store.set({ theme: 'dark' })).toBe(next)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(fs.statSync(file).mtimeMs).toBe(mtime)
    off()
    store.set({ theme: 'light' })
    expect(listener).toHaveBeenCalledTimes(1)
    // Relu par un nouveau magasin.
    expect(createPrefsStore({ file }).get().theme).toBe('light')
  })

  it('patch invalide : ZodError, rien n’est écrit ni modifié', () => {
    const store = createPrefsStore({ file })
    expect(() => store.set({ defaultColumns: 12 })).toThrow()
    expect(store.get()).toEqual(DEFAULT_PREFS)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('JSON illisible : mis de côté, défauts ; champ invalide : réparé sans perdre le reste', () => {
    fs.writeFileSync(file, '{oups')
    const warn = vi.fn()
    expect(createPrefsStore({ file, log: { warn, error: vi.fn() }, now: () => 7 }).get()).toEqual(
      DEFAULT_PREFS,
    )
    expect(fs.existsSync(`${file}.bad-7`)).toBe(true)
    expect(warn).toHaveBeenCalled()
    fs.writeFileSync(
      file,
      JSON.stringify({ theme: 'dark', defaultColumns: 99, ai: { consentVersion: 2 } }),
    )
    const store = createPrefsStore({ file })
    expect(store.get()).toMatchObject({
      theme: 'dark',
      defaultColumns: 4,
      ai: { consentVersion: 2 },
    })
    store.persist()
    expect(onDisk().defaultColumns).toBe(4)
  })

  it('un écouteur en échec n’empêche pas les autres', () => {
    const error = vi.fn()
    const store = createPrefsStore({ file, log: { warn: vi.fn(), error } })
    const ok = vi.fn()
    store.onChange(() => {
      throw new Error('x')
    })
    store.onChange(ok)
    store.set({ hoverPlay: false })
    expect(ok).toHaveBeenCalled()
    expect(error).toHaveBeenCalled()
  })

  it('singleton', () => {
    expect(getPrefsStore()).toBeNull()
    expect(() => requirePrefsStore()).toThrow(expect.objectContaining({ code: 'internal' }))
  })
})

describe('initPrefs + handlers prefs.*', () => {
  const ctx = (emit: ServiceContext['emit']): ServiceContext => ({
    userData: dir,
    flags: { e2e: true, windowSize: null, home: null, rendererUrl: null, installDevHost: false },
    isPackaged: false,
    getMainWindow: () => null,
    emit,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })
  const call = (channel: string, input: unknown = {}) =>
    dispatch(channel, input, {}, { handlers: prefsHandlers, validateOutput: true })

  it('prefs.changed émis, thème natif synchronisé, clés réservées refusées', async () => {
    fs.writeFileSync(file, JSON.stringify({ theme: 'light' }))
    const emit = vi.fn()
    const dispose = initPrefs(ctx(emit))
    expect(electron.nativeTheme.themeSource).toBe('light')
    expect(await call('prefs.get')).toMatchObject({ ok: true, data: { theme: 'light' } })
    const res = await call('prefs.set', { patch: { theme: 'dark', defaultColumns: 6 } })
    expect(res).toMatchObject({ ok: true, data: { theme: 'dark', defaultColumns: 6 } })
    expect(electron.nativeTheme.themeSource).toBe('dark')
    expect(emit).toHaveBeenCalledWith('prefs.changed', expect.objectContaining({ theme: 'dark' }))
    expect(onDisk()).toMatchObject({ theme: 'dark', defaultColumns: 6 })
    emit.mockClear()
    await call('prefs.set', { patch: { hoverPlay: false } })
    expect(emit).toHaveBeenCalledTimes(1)
    expect(electron.nativeTheme.themeSource).toBe('dark')
    expect(await call('prefs.set', { patch: { tools: { ffmpeg: '/x' } } })).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    })
    expect(await call('prefs.set', { patch: { ai: { consentVersion: 3 } } })).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    })
    await dispose()
    expect(getPrefsStore()).toBeNull()
  })
})

describe('prefs.json écrit au premier lancement et après réparation', () => {
  const serviceCtx = (): ServiceContext => ({
    userData: dir,
    flags: { e2e: true, windowSize: null, home: null, rendererUrl: null, installDevHost: false },
    isPackaged: false,
    getMainWindow: () => null,
    emit: vi.fn(),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })

  it('repairedAtOpen : absent, mis de côté ou réparé → vrai ; fichier valide → faux', () => {
    expect(createPrefsStore({ file }).repairedAtOpen).toBe(true)
    fs.writeFileSync(file, '{oups')
    expect(createPrefsStore({ file, now: () => 3 }).repairedAtOpen).toBe(true)
    fs.writeFileSync(file, JSON.stringify({ theme: 'dark', defaultColumns: 99 }))
    expect(createPrefsStore({ file }).repairedAtOpen).toBe(true)
    // Un fichier produit par le magasin lui-même est relu tel quel.
    const store = createPrefsStore({ file })
    store.set({ theme: 'light' })
    expect(createPrefsStore({ file }).repairedAtOpen).toBe(false)
  })

  it('initPrefs crée prefs.json au premier lancement', async () => {
    const dispose = initPrefs(serviceCtx())
    expect(onDisk()).toEqual(DEFAULT_PREFS)
    await dispose()
  })

  it('initPrefs réécrit un fichier mis de côté : le fichier est reconstitué sur disque', async () => {
    fs.writeFileSync(file, '{oups')
    const dispose = initPrefs(serviceCtx())
    expect(fs.readdirSync(dir).some((f) => f.startsWith('prefs.json.bad-'))).toBe(true)
    expect(onDisk()).toEqual(DEFAULT_PREFS)
    await dispose()
  })

  it('initPrefs réécrit un champ réparé sans perdre le reste', async () => {
    fs.writeFileSync(file, JSON.stringify({ theme: 'dark', defaultColumns: 99 }))
    const dispose = initPrefs(serviceCtx())
    expect(onDisk()).toMatchObject({ theme: 'dark', defaultColumns: DEFAULT_PREFS.defaultColumns })
    await dispose()
  })
})
