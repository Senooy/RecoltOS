/**
 * WP-05 — glisser vers l'extérieur (ARCHI §2.5) : `startDrag` appelé de façon synchrone avec les
 * ORIGINAUX, icône `createFromDataURL` sinon `drag-fallback.png` sinon icône système ; expéditeur
 * et charge validés. Le glisser réel vers le Finder reste une vérification manuelle.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import {
  DRAG_MAX_ITEMS,
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
  it('accepte uuids + dataURL PNG, dédoublonne', () => {
    expect(parseDragPayload({ uuids: [A, B, A], iconDataUrl: PNG })).toEqual({
      uuids: [A, B],
      iconDataUrl: PNG,
    })
    expect(parseDragPayload({ uuids: [A] })).toEqual({ uuids: [A], iconDataUrl: null })
  })

  it.each([
    ['vide', { uuids: [] }],
    ['uuid invalide', { uuids: ['../../etc'] }],
    ['pas un objet', 'x'],
    ['icône non PNG', { uuids: [A], iconDataUrl: 'data:image/webp;base64,AAAA' }],
    ['icône URL', { uuids: [A], iconDataUrl: 'file:///etc/passwd' }],
  ])('refuse %s', (_l, raw) => {
    expect(parseDragPayload(raw)).toBeNull()
  })

  it('tronque une sélection géante', () => {
    const many = Array.from(
      { length: DRAG_MAX_ITEMS + 10 },
      (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`,
    )
    expect(parseDragPayload({ uuids: many })!.uuids).toHaveLength(DRAG_MAX_ITEMS)
  })
})

describe('makeDragIcon', () => {
  it('dataURL du renderer en priorité', () => {
    const imgs = fakeImages()
    expect((makeDragIcon(imgs as never, '/f.png', PNG) as unknown as Img).tag).toBe('data')
    expect(imgs.createFromPath).not.toHaveBeenCalled()
  })

  it('dataURL vide ou illisible → drag-fallback.png', () => {
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

  it('repli manquant → icône système', () => {
    const imgs = fakeImages({ createFromPath: img('f', true) })
    expect((makeDragIcon(imgs as never, '/absent.png', null) as unknown as Img).tag).toBe('system')
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

  it('canal `drag` : startDrag synchrone avec les originaux et l’icône', () => {
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

  it('expéditeur non autorisé, charge invalide ou rien à glisser : pas de startDrag', () => {
    const s = setup()
    s.send({ uuids: [A] }, 'https://evil.example/')
    s.send({ uuids: ['x'] })
    expect(s.startDrag).not.toHaveBeenCalled()
    expect(s.log.warn).toHaveBeenCalledTimes(2)
    const none = setup({ files: [] })
    none.send({ uuids: [A] })
    expect(none.startDrag).not.toHaveBeenCalled()
  })

  it('une exception de startDrag est journalisée, jamais propagée', () => {
    const s = setup()
    s.startDrag.mockImplementation(() => {
      throw new Error('boum')
    })
    expect(() => s.send({ uuids: [A] })).not.toThrow()
    expect(s.log.error).toHaveBeenCalled()
  })
})

describe('resources/drag-fallback.png', () => {
  it('existe au chemin résolu depuis la racine de l’app, PNG 128 px décodable', async () => {
    const file = dragFallbackPath(REPO_ROOT)
    expect(file).toBe(join(REPO_ROOT, 'resources', 'drag-fallback.png'))
    expect(existsSync(file)).toBe(true)
    const meta = await sharp(file).metadata()
    expect(meta).toMatchObject({ format: 'png', width: 128, height: 128 })
    const { info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
    expect(info.channels).toBe(4)
  })
})
