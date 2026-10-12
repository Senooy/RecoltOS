import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  nativeTheme: { themeSource: 'system' },
  app: { getPreferredSystemLanguages: () => ['fr-FR', 'en-US'], getLocale: () => 'fr' },
}))
vi.mock('electron', () => electron)

import { DEFAULT_PREFS } from '../../../src/shared/prefs'
import { dispatch } from '../../../src/main/ipc/router'
import { prefsHandlers } from '../../../src/main/ipc/handlers/prefs'
import { detectSystemLang, initPrefs } from '../../../src/main/prefs/init'
import {
  createPrefsStore,
  getPrefsStore,
  requirePrefsStore,
  setPrefsStore,
} from '../../../src/main/prefs/store'
import type { ServiceContext } from '../../../src/main/bootstrap/context'
import { getLang, onLangChange, setLang } from '../../../src/shared/i18n/lang'

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
  it('missing file: defaults; deep patch written atomically and notifies', () => {
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
    // No-op patch: no write nor notification.
    const mtime = fs.statSync(file).mtimeMs
    expect(store.set({ theme: 'dark' })).toBe(next)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(fs.statSync(file).mtimeMs).toBe(mtime)
    off()
    store.set({ theme: 'light' })
    expect(listener).toHaveBeenCalledTimes(1)
    // Read back by a new store.
    expect(createPrefsStore({ file }).get().theme).toBe('light')
  })

  it('invalid patch: ZodError, nothing written or changed', () => {
    const store = createPrefsStore({ file })
    expect(() => store.set({ defaultColumns: 12 })).toThrow()
    expect(store.get()).toEqual(DEFAULT_PREFS)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('unreadable JSON: set aside, defaults; invalid field: repaired without losing the rest', () => {
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

  it('a failing listener does not prevent the others', () => {
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

describe('initPrefs + prefs.* handlers', () => {
  const ctx = (emit: ServiceContext['emit']): ServiceContext => ({
    userData: dir,
    flags: {
      e2e: true,
      windowSize: null,
      home: null,
      rendererUrl: null,
      installDevHost: false,
      systemLang: null,
    },
    isPackaged: false,
    getMainWindow: () => null,
    emit,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })
  const call = (channel: string, input: unknown = {}) =>
    dispatch(channel, input, {}, { handlers: prefsHandlers, validateOutput: true })

  it('prefs.changed emitted, native theme synced, reserved keys refused', async () => {
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

  it('system language: first preferred language of the Mac, except RECOLTOS_LANG', () => {
    expect(detectSystemLang(null)).toBe('fr')
    expect(detectSystemLang('en')).toBe('en')
    const spy = vi
      .spyOn(electron.app, 'getPreferredSystemLanguages')
      .mockReturnValue(['en-GB', 'fr-FR'])
    expect(detectSystemLang(null)).toBe('en')
    spy.mockReturnValue([])
    expect(detectSystemLang(null)).toBe('fr')
    spy.mockRestore()
  })

  it('language: simulated system, then ui.language applied live (onLangChange)', async () => {
    const seen: string[] = []
    const off = onLangChange((l) => seen.push(l))
    const base = ctx(vi.fn())
    const dispose = initPrefs({ ...base, flags: { ...base.flags, systemLang: 'en' } })
    try {
      expect(getLang()).toBe('en')
      await call('prefs.set', { patch: { ui: { language: 'fr' } } })
      expect(getLang()).toBe('fr')
      await call('prefs.set', { patch: { ui: { language: 'system' } } })
      expect(getLang()).toBe('en')
      expect(seen).toEqual(['en', 'fr', 'en'])
      expect(onDisk()).toMatchObject({ ui: { language: 'system' } })
    } finally {
      off()
      await dispose()
      setLang('fr')
    }
  })
})

describe('prefs.json written at first launch and after repair', () => {
  const serviceCtx = (): ServiceContext => ({
    userData: dir,
    flags: {
      e2e: true,
      windowSize: null,
      home: null,
      rendererUrl: null,
      installDevHost: false,
      systemLang: null,
    },
    isPackaged: false,
    getMainWindow: () => null,
    emit: vi.fn(),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })

  it('repairedAtOpen: missing, set aside or repaired → true; valid file → false', () => {
    expect(createPrefsStore({ file }).repairedAtOpen).toBe(true)
    fs.writeFileSync(file, '{oups')
    expect(createPrefsStore({ file, now: () => 3 }).repairedAtOpen).toBe(true)
    fs.writeFileSync(file, JSON.stringify({ theme: 'dark', defaultColumns: 99 }))
    expect(createPrefsStore({ file }).repairedAtOpen).toBe(true)
    // A file produced by the store itself is read back as is.
    const store = createPrefsStore({ file })
    store.set({ theme: 'light' })
    expect(createPrefsStore({ file }).repairedAtOpen).toBe(false)
  })

  it('initPrefs creates prefs.json at first launch', async () => {
    const dispose = initPrefs(serviceCtx())
    expect(onDisk()).toEqual(DEFAULT_PREFS)
    await dispose()
  })

  it('initPrefs rewrites a set-aside file: the file is rebuilt on disk', async () => {
    fs.writeFileSync(file, '{oups')
    const dispose = initPrefs(serviceCtx())
    expect(fs.readdirSync(dir).some((f) => f.startsWith('prefs.json.bad-'))).toBe(true)
    expect(onDisk()).toEqual(DEFAULT_PREFS)
    await dispose()
  })

  it('initPrefs rewrites a repaired field without losing the rest', async () => {
    fs.writeFileSync(file, JSON.stringify({ theme: 'dark', defaultColumns: 99 }))
    const dispose = initPrefs(serviceCtx())
    expect(onDisk()).toMatchObject({ theme: 'dark', defaultColumns: DEFAULT_PREFS.defaultColumns })
    await dispose()
  })
})
