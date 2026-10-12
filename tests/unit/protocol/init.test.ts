/**
 * `initProtocol` (simulated Electron): `recolt:` registered on the default session and on
 * each off-screen session, `drag` channel, active library
 * re-read at each request, everything removed on `dispose`. Outside Electron: no registration, no failure.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

type Handler = (req: Request) => Promise<Response>

const state = vi.hoisted(() => ({
  electronAvailable: true,
  handled: new Map<string, (req: Request) => Promise<Response>>(),
  setups: [] as ((ses: unknown) => void)[],
  pages: [] as { session: unknown; url: string }[],
  ipcOn: [] as string[],
  ipcOff: [] as string[],
}))

vi.mock('electron', () => ({
  get protocol() {
    if (!state.electronAvailable) return undefined
    return {
      handle: (s: string, h: Handler) => state.handled.set(s, h),
      unhandle: (s: string) => state.handled.delete(s),
      isProtocolHandled: (s: string) => state.handled.has(s),
    }
  },
  app: { getAppPath: () => '/app' },
  ipcMain: {
    on: (c: string) => state.ipcOn.push(c),
    removeListener: (c: string) => state.ipcOff.push(c),
  },
  nativeImage: {},
  webContents: {
    getAllWebContents: () =>
      state.pages.map((p) => ({
        session: p.session,
        isDestroyed: () => false,
        getURL: () => p.url,
      })),
  },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('../../../src/main/windows/offscreen', () => ({
  registerOffscreenSessionSetup: (fn: (ses: unknown) => void) => state.setups.push(fn),
}))

import type { ServiceContext } from '../../../src/main/bootstrap/context'
import {
  resetLibraryContextForTests,
  setActiveLibrary,
  type LibraryContext,
} from '../../../src/main/library/library-context'
import { initProtocol } from '../../../src/main/protocol/init'
import { makeTmpDir } from '../../helpers/tmpdir'

function ctx(): ServiceContext {
  return {
    userData: '/tmp/u',
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
    emit: () => undefined,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
}

afterEach(() => {
  state.electronAvailable = true
  state.handled.clear()
  state.setups.length = 0
  state.pages.length = 0
  state.ipcOn.length = 0
  state.ipcOff.length = 0
  resetLibraryContextForTests()
})

describe('initProtocol', () => {
  it('default session + off-screen sessions + drag channel; dispose removes everything', async () => {
    const root = makeTmpDir('recolt-init-')
    mkdirSync(join(root, 'thumbs', 'ab'), { recursive: true })
    writeFileSync(join(root, 'thumbs', 'ab', 'x.webp'), 'webp')
    setActiveLibrary({ id: 'default', root } as LibraryContext)

    const dispose = initProtocol(ctx())
    expect(typeof dispose).toBe('function')
    const h = state.handled.get('recolt')!
    expect(h).toBeTypeOf('function')
    expect(state.ipcOn).toEqual(['drag'])

    const ok = await h(new Request('recolt://default/thumbs/ab/x.webp'))
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('webp')
    expect((await h(new Request('recolt://autre/thumbs/ab/x.webp'))).status).toBe(404)

    // Off-screen session: same handler, read-only.
    expect(state.setups).toHaveLength(1)
    const offHandled = new Map<string, Handler>()
    const ses = {
      protocol: {
        handle: (s: string, fn: Handler) => offHandled.set(s, fn),
        isProtocolHandled: (s: string) => offHandled.has(s),
      },
    }
    state.setups[0]!(ses)
    state.setups[0]!(ses)
    const off = offHandled.get('recolt')!
    // Internal page: served.
    state.pages.push({
      session: ses,
      url: 'file:///app/out/renderer/offscreen.html?render=tweet-card',
    })
    expect((await off(new Request('recolt://default/thumbs/ab/x.webp'))).status).toBe(200)
    expect(
      (await off(new Request('recolt://default/thumbs/ab/x.webp', { method: 'POST' }))).status,
    ).toBe(405)

    // Switch: the library is re-read at each request.
    resetLibraryContextForTests()
    expect((await h(new Request('recolt://default/thumbs/ab/x.webp'))).status).toBe(404)

    await (dispose as () => Promise<void>)()
    expect(state.handled.has('recolt')).toBe(false)
    expect(state.ipcOff).toEqual(['drag'])
  })

  it('off-screen session: a captured http(s) page or no page → 403, internal page → 200', async () => {
    const root = makeTmpDir('recolt-init-guard-')
    mkdirSync(join(root, 'avatars', 'x'), { recursive: true })
    writeFileSync(join(root, 'avatars', 'x', 'a.jpg'), 'jpg')
    setActiveLibrary({ id: 'default', root } as LibraryContext)
    const dispose = initProtocol({
      ...ctx(),
      flags: { ...ctx().flags, rendererUrl: 'http://localhost:5173/' },
    })

    const offHandled = new Map<string, Handler>()
    const ses = {
      protocol: {
        handle: (s: string, fn: Handler) => offHandled.set(s, fn),
        isProtocolHandled: (s: string) => offHandled.has(s),
      },
    }
    state.setups[0]!(ses)
    const off = offHandled.get('recolt')!
    const probe = () => off(new Request('recolt://default/avatars/x/a.jpg'))

    // No identifiable window: fail closed.
    expect((await probe()).status).toBe(403)

    // Remote page (fetch / <img>: the handler only sees the request, not its headers).
    state.pages.push({ session: ses, url: 'https://evil.example/page.html' })
    expect((await probe()).status).toBe(403)
    expect(
      (await off(new Request('recolt://default/avatars/x/a.jpg', { method: 'OPTIONS' }))).status,
    ).toBe(403)

    // A window from another session does not count; the remote page still blocks.
    state.pages.push({ session: {}, url: 'file:///app/out/renderer/offscreen.html' })
    expect((await probe()).status).toBe(403)

    // Internal page only (Vite dev server): served.
    state.pages.length = 0
    state.pages.push({
      session: ses,
      url: 'http://localhost:5173/offscreen.html?render=space-stage',
    })
    expect((await probe()).status).toBe(200)

    // Same dev origin but another page: refused.
    state.pages.length = 0
    state.pages.push({ session: ses, url: 'http://localhost:5173/index.html' })
    expect((await probe()).status).toBe(403)

    await (dispose as () => Promise<void>)()
  })

  it('outside Electron: warns and wires nothing', () => {
    state.electronAvailable = false
    const warn = vi.fn()
    const c = { ...ctx(), log: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() } }
    expect(initProtocol(c)).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    expect(state.ipcOn).toEqual([])
  })
})
