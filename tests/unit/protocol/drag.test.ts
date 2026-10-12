/**
 * Dragging outward: `startDrag` called synchronously with the
 * ORIGINALS, icon `createFromDataURL` otherwise `drag-fallback.png` otherwise system icon; sender
 * and payload validated. The real drag to Finder remains a manual check.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import {
  DRAG_ICON_MAX_CHARS,
  DRAG_MAX_ITEMS,
  PNG_DATA_URL_PREFIX,
  SYSTEM_DRAG_ICON,
  makeDragIcon,
  parseDragPayload,
  registerDrag,
  type NativeImageApi,
} from '../../../src/main/drag'
import { dragFallbackPath } from '../../../src/main/protocol/init'
import { REPO_ROOT } from '../../helpers/paths'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const PNG = 'data:image/png;base64,iVBORw0KGgo='

type Img = { isEmpty(): boolean; tag: string }
const img = (tag: string, emptyImg = false): Img => ({ tag, isEmpty: () => emptyImg })

function fakeImages(over: Partial<Record<keyof NativeImageApi, Img | Error>> = {}) {
  const call = (k: keyof NativeImageApi, dflt: Img) =>
    vi.fn(() => {
      const v = over[k] ?? dflt
      if (v instanceof Error) throw v
      return v
    })
  return {
    createFromDataURL: call('createFromDataURL', img('data')),
    createFromPath: call('createFromPath', img('fallback')),
    createFromNamedImage: call('createFromNamedImage', img('system')),
  }
}

describe('parseDragPayload', () => {
  it('accepts uuids + PNG dataURL, deduplicates', () => {
    expect(parseDragPayload({ uuids: [A, B, A], iconDataUrl: PNG })).toEqual({
      uuids: [A, B],
      iconDataUrl: PNG,
    })
    expect(parseDragPayload({ uuids: [A] })).toEqual({ uuids: [A], iconDataUrl: null })
  })

  it.each([
    ['empty', { uuids: [] }],
    ['invalid uuid', { uuids: ['../../etc'] }],
    ['not an object', 'x'],
    ['all uuids invalid', { uuids: ['x', 42, null] }],
    ['missing uuids', { iconDataUrl: PNG }],
  ])('refuses %s', (_l, raw) => {
    expect(parseDragPayload(raw)).toBeNull()
  })

  it.each([
    ['JPEG', 'data:image/jpeg;base64,AAAA'],
    ['webp', 'data:image/webp;base64,AAAA'],
    ['URL', 'file:///etc/passwd'],
    ['too large', PNG_DATA_URL_PREFIX + 'A'.repeat(DRAG_ICON_MAX_CHARS)],
    ['not a string', 42],
  ])('invalid icon (%s): payload kept, icon reset to null', (_l, icon) => {
    expect(parseDragPayload({ uuids: [A], iconDataUrl: icon })).toEqual({
      uuids: [A],
      iconDataUrl: null,
    })
  })

  it('drops invalid uuids without discarding the payload', () => {
    expect(parseDragPayload({ uuids: [A, 'not-a-uuid', B, 7] })).toEqual({
      uuids: [A, B],
      iconDataUrl: null,
    })
  })

  it('truncates a huge selection', () => {
    const many = Array.from(
      { length: DRAG_MAX_ITEMS + 10 },
      (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`,
    )
    expect(parseDragPayload({ uuids: many })!.uuids).toHaveLength(DRAG_MAX_ITEMS)
  })
})

describe('makeDragIcon', () => {
  it('renderer dataURL takes priority', () => {
    const imgs = fakeImages()
    expect((makeDragIcon(imgs as never, '/f.png', PNG) as unknown as Img).tag).toBe('data')
    expect(imgs.createFromPath).not.toHaveBeenCalled()
  })

  it('empty or unreadable dataURL → drag-fallback.png', () => {
    expect(
      (
        makeDragIcon(
          fakeImages({ createFromDataURL: img('d', true) }) as never,
          '/f.png',
          PNG,
        ) as unknown as Img
      ).tag,
    ).toBe('fallback')
    expect(
      (
        makeDragIcon(
          fakeImages({ createFromDataURL: new Error('x') }) as never,
          '/f.png',
          PNG,
        ) as unknown as Img
      ).tag,
    ).toBe('fallback')
    const imgs = fakeImages()
    expect((makeDragIcon(imgs as never, '/f.png', null) as unknown as Img).tag).toBe('fallback')
    expect(imgs.createFromPath).toHaveBeenCalledWith('/f.png')
  })

  it('missing fallback → system icon', () => {
    const imgs = fakeImages({ createFromPath: img('f', true) })
    expect((makeDragIcon(imgs as never, '/missing.png', null) as unknown as Img).tag).toBe('system')
    expect(imgs.createFromNamedImage).toHaveBeenCalledWith(SYSTEM_DRAG_ICON)
  })
})

describe('registerDrag', () => {
  function setup(opts: { allowed?: boolean; files?: string[] } = {}) {
    let listener: ((e: unknown, p: unknown) => void) | null = null
    const ipcMain = {
      on: vi.fn((_c: string, l: (e: unknown, p: unknown) => void) => {
        listener = l
      }),
      removeListener: vi.fn(),
    }
    const files = vi.fn(() => opts.files ?? ['/lib/items/11/a.webp', '/lib/items/22/b.mp4'])
    const icon = vi.fn(() => ({ tag: 'icon' }))
    const log = { warn: vi.fn(), error: vi.fn() }
    const dispose = registerDrag({
      ipcMain,
      isAllowedSender: (u) => (opts.allowed ?? true) && u === 'file:///app/index.html',
      files,
      icon: icon as never,
      log,
    })
    const startDrag = vi.fn()
    const send = (payload: unknown, url = 'file:///app/index.html') =>
      listener!({ senderFrame: { url }, sender: { startDrag } }, payload)
    return { ipcMain, files, icon, log, dispose, startDrag, send }
  }

  it('`drag` channel: synchronous startDrag with the originals and the icon', () => {
    const s = setup()
    expect(s.ipcMain.on).toHaveBeenCalledWith('drag', expect.any(Function))
    s.send({ uuids: [A, B], iconDataUrl: PNG })
    expect(s.files).toHaveBeenCalledWith([A, B])
    expect(s.icon).toHaveBeenCalledWith(PNG)
    expect(s.startDrag).toHaveBeenCalledWith({
      file: '/lib/items/11/a.webp',
      files: ['/lib/items/11/a.webp', '/lib/items/22/b.mp4'],
      icon: { tag: 'icon' },
    })
    s.dispose()
    expect(s.ipcMain.removeListener).toHaveBeenCalledWith('drag', expect.any(Function))
  })

  it('unauthorized sender, invalid payload or nothing to drag: no startDrag', () => {
    const s = setup()
    s.send({ uuids: [A] }, 'https://evil.example/')
    s.send({ uuids: ['x'] })
    expect(s.startDrag).not.toHaveBeenCalled()
    expect(s.log.warn).toHaveBeenCalledTimes(2)
    const none = setup({ files: [] })
    none.send({ uuids: [A] })
    expect(none.startDrag).not.toHaveBeenCalled()
  })

  it('invalid icon or mixed uuid: startDrag called with the fallback icon', () => {
    const fallback = { tag: 'fallback' }
    let listener: ((e: unknown, p: unknown) => void) | null = null
    const files = vi.fn(() => ['/lib/items/11/a.webp'])
    const images = fakeImages({ createFromPath: img('fallback') })
    registerDrag({
      ipcMain: {
        on: vi.fn((_c: string, l: (e: unknown, p: unknown) => void) => {
          listener = l
        }),
        removeListener: vi.fn(),
      },
      isAllowedSender: () => true,
      files,
      icon: (url) => makeDragIcon(images as never, '/f.png', url),
    })
    const startDrag = vi.fn()
    const send = (p: unknown) => listener!({ senderFrame: { url: 'x' }, sender: { startDrag } }, p)
    for (const icon of [
      'data:image/jpeg;base64,AAAA',
      PNG_DATA_URL_PREFIX + 'A'.repeat(DRAG_ICON_MAX_CHARS),
    ]) {
      startDrag.mockClear()
      send({ uuids: [A], iconDataUrl: icon })
      expect(startDrag).toHaveBeenCalledTimes(1)
      expect(startDrag.mock.calls[0]![0]).toMatchObject({ icon: fallback })
    }
    startDrag.mockClear()
    send({ uuids: [A, 'not-a-uuid'], iconDataUrl: PNG })
    expect(files).toHaveBeenLastCalledWith([A])
    expect(startDrag).toHaveBeenCalledTimes(1)
  })

  it('a startDrag exception is logged, never propagated', () => {
    const s = setup()
    s.startDrag.mockImplementation(() => {
      throw new Error('boum')
    })
    expect(() => s.send({ uuids: [A] })).not.toThrow()
    expect(s.log.error).toHaveBeenCalled()
  })
})

describe('resources/drag-fallback.png', () => {
  it('exists at the path resolved from the app root, 128 px PNG decodable', async () => {
    const file = dragFallbackPath(REPO_ROOT)
    expect(file).toBe(join(REPO_ROOT, 'resources', 'drag-fallback.png'))
    expect(existsSync(file)).toBe(true)
    const meta = await sharp(file).metadata()
    expect(meta).toMatchObject({ format: 'png', width: 128, height: 128 })
    const { info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
    expect(info.channels).toBe(4)
  })
})
