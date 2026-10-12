import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
}))
vi.mock('electron', () => electron)

import { dispatch } from '../../../src/main/ipc/router'
import { librariesHandlers } from '../../../src/main/ipc/handlers/libraries'
import { getLibraryManager, initLibrary, setLibraryManager } from '../../../src/main/library/init'
import { resetLibraryContextForTests } from '../../../src/main/library/library-context'
import type { ServiceContext } from '../../../src/main/bootstrap/context'

let base: string
let dispose: (() => void | Promise<void>) | null
const emit = vi.fn()
const call = (channel: string, input: unknown = {}) =>
  dispatch(channel, input, {}, { handlers: librariesHandlers, validateOutput: true })

function ctx(over: Partial<ServiceContext> = {}): ServiceContext {
  return {
    userData: path.join(base, 'userData'),
    flags: {
      e2e: true,
      windowSize: null,
      home: path.join(base, 'home'),
      rendererUrl: null,
      installDevHost: false,
      systemLang: null,
    },
    isPackaged: false,
    getMainWindow: () => null,
    emit,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...over,
  }
}

beforeEach(async () => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'recolt-h-')))
  emit.mockClear()
  resetLibraryContextForTests()
  dispose = await initLibrary(ctx())
})
afterEach(async () => {
  await dispose?.()
  resetLibraryContextForTests()
  fs.rmSync(base, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('libraries.* handlers', () => {
  it('list / create / switch / rename / remove via the router (validated outputs)', async () => {
    expect(await call('libraries.list')).toEqual({
      ok: true,
      data: {
        active: 'default',
        libraries: [{ id: 'default', name: 'Bibliothèque', path: null, itemCount: 0 }],
      },
    })
    const created = await call('libraries.create', { name: 'Seconde' })
    expect(created.ok).toBe(true)
    const id = (created as { data: { id: string } }).data.id
    expect(emit).toHaveBeenCalledWith('library.switched', { libraryId: id })
    expect(await call('libraries.switch', { id: 'default' })).toEqual({ ok: true, data: undefined })
    expect(await call('libraries.rename', { id, name: 'Deux' })).toMatchObject({
      ok: true,
      data: { name: 'Deux' },
    })
    expect(await call('libraries.remove', { id, deleteFiles: false })).toEqual({
      ok: true,
      data: undefined,
    })
    expect(await call('libraries.remove', { id: 'default', deleteFiles: true })).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    })
  })

  it('create inside iCloud Drive: synced_folder_refused', async () => {
    const icloud = path.join(
      base,
      'home',
      'Library',
      'Mobile Documents',
      'com~apple~CloudDocs',
      'Lib',
    )
    expect(await call('libraries.create', { name: 'Nuage', path: icloud })).toMatchObject({
      ok: false,
      error: { code: 'synced_folder_refused' },
    })
    expect(emit).not.toHaveBeenCalled()
  })

  it('openFolder: cancelled → null; chosen folder → switch', async () => {
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await call('libraries.openFolder')).toEqual({ ok: true, data: null })
    const created = (await call('libraries.create', { name: 'X', path: path.join(base, 'x') })) as {
      data: { id: string }
    }
    await call('libraries.switch', { id: 'default' })
    electron.BrowserWindow.fromWebContents.mockReturnValue({})
    electron.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [path.join(base, 'x')],
    })
    const sender = {} as never
    const res = await dispatch(
      'libraries.openFolder',
      {},
      { sender },
      { handlers: librariesHandlers, validateOutput: true },
    )
    expect(res).toMatchObject({ ok: true, data: { id: created.data.id } })
    expect(electron.dialog.showOpenDialog).toHaveBeenLastCalledWith(
      {},
      expect.objectContaining({ properties: ['openDirectory'] }),
    )
  })

  it('reveal: opens the folder; Finder error surfaced', async () => {
    electron.shell.openPath.mockResolvedValueOnce('')
    expect(await call('libraries.reveal', { id: 'default' })).toEqual({ ok: true, data: undefined })
    expect(electron.shell.openPath).toHaveBeenCalledWith(
      path.join(base, 'userData', 'libraries', 'default'),
    )
    electron.shell.openPath.mockResolvedValueOnce('refusé')
    expect(await call('libraries.reveal', { id: 'default' })).toMatchObject({
      ok: false,
      error: {
        code: 'io',
        message: 'Impossible d’ouvrir le dossier dans le Finder.',
        details: { message: 'refusé' },
      },
    })
  })

  it('without manager: library_unavailable', async () => {
    const m = getLibraryManager()
    setLibraryManager(null)
    expect(await call('libraries.list')).toMatchObject({
      ok: false,
      error: { code: 'library_unavailable' },
    })
    setLibraryManager(m)
  })

  it('initLibrary in packaged build: no slow-query log', async () => {
    await dispose?.()
    resetLibraryContextForTests()
    dispose = await initLibrary(
      ctx({
        isPackaged: true,
        flags: {
          e2e: false,
          windowSize: null,
          home: null,
          rendererUrl: null,
          installDevHost: false,
          systemLang: null,
        },
      }),
    )
    expect(getLibraryManager()?.active()?.id).toBe('default')
  })
})
