/**
 * handlers `system.*` via `dispatch` (validation zod des entrées et sorties), Electron
 * simulé. `copyImage` d'un webp passe par le vrai `toPng` (sharp, en processus) : le PNG écrit dans
 * le presse-papiers est décodable et non vide. Le collage réel est couvert par l'e2e
 * `tests/unit/protocol/e2e/recolt-protocol.spec.ts`.
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import type * as Binaries from '../../../src/main/platform/binaries'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  class ClipboardItem {
    readonly items: Record<string, unknown>
    constructor(items: Record<string, unknown>) {
      this.items = items
    }
  }
  return {
    app: {
      getVersion: vi.fn(() => '0.0.0'),
      getPath: vi.fn(() => '/Users/test/Downloads'),
      isPackaged: false,
    },
    BrowserWindow: { fromWebContents: vi.fn() },
    ClipboardItem,
    clipboard: {
      write: vi.fn(() => Promise.resolve()),
      writeText: vi.fn(() => Promise.resolve()),
    },
    dialog: { showSaveDialog: vi.fn() },
    nativeImage: {
      createFromBuffer: vi.fn((b: Buffer) => ({ isEmpty: () => b.length === 0 })),
    },
    shell: {
      showItemInFolder: vi.fn(),
      openExternal: vi.fn(() => Promise.resolve()),
      openPath: vi.fn(() => Promise.resolve('')),
    },
  }
})
vi.mock('electron', () => electron)
vi.mock('../../../src/main/platform/binaries', async (orig) => ({
  ...(await orig<typeof Binaries>()),
  resolveBinaries: vi.fn(() =>
    Promise.resolve({
      sips: '/usr/bin/sips',
      ffmpeg: '/opt/homebrew/bin/ffmpeg',
      ffprobe: '/opt/homebrew/bin/ffprobe',
    }),
  ),
}))
vi.mock('electron-log/main', () => ({
  default: {
    transports: { file: { getFile: () => ({ path: '/tmp/recolt-logs-test/main.log' }) } },
  },
}))

import { createRepos } from '../../../src/main/db/repos'
import { systemHandlers, suggestedFileName } from '../../../src/main/ipc/handlers/system'
import { dispatch } from '../../../src/main/ipc/router'
import {
  resetLibraryContextForTests,
  setActiveLibrary,
  type LibraryContext,
} from '../../../src/main/library/library-context'
import { libraryPaths } from '../../../src/main/library/paths'
import {
  provideMediaWorker,
  resetMediaWorkerAccessForTests,
} from '../../../src/main/protocol/media-worker'
import { createPrefsStore, setPrefsStore } from '../../../src/main/prefs/store'
import { toPng } from '../../../src/main/workers/media/files'
import type { MediaWorker } from '../../../src/main/workers-host'
import { openTestDb, type TestDb } from '../../helpers/db'
import { makeTmpDir } from '../../helpers/tmpdir'

const IMG = '11111111-1111-4111-8111-111111111111'
const VID = '22222222-2222-4222-8222-222222222222'
let db: TestDb
let lib: LibraryContext
const uuids: Record<string, string> = {}
const toPngCalls: { abs: string; maxEdge?: number }[] = []

const call = (channel: string, input: unknown = {}, ctx: object = {}) =>
  dispatch(channel, input, ctx, { handlers: systemHandlers, validateOutput: true })

async function writeImg(rel: string, format: 'webp' | 'jpeg'): Promise<void> {
  const abs = join(lib.root, rel)
  mkdirSync(dirname(abs), { recursive: true })
  await sharp({ create: { width: 64, height: 48, channels: 3, background: '#c83c28' } })
    .toFormat(format)
    .toFile(abs)
}

beforeAll(async () => {
  const root = makeTmpDir('recolt-system-')
  db = openTestDb()
  const repos = createRepos(db)
  lib = { id: 'default', name: 'B', root, paths: libraryPaths(root), db, repos }
  uuids.image = repos.items.insertWithMedia({ kind: 'image', title: 'Plage : été/2026' }, [
    { mediaType: 'image', uuid: IMG, fileRel: `items/11/${IMG}.webp` },
  ]).uuid
  uuids.video = repos.items.insertWithMedia({ kind: 'video' }, [
    {
      mediaType: 'video',
      uuid: VID,
      fileRel: `items/22/${VID}.mp4`,
      posterRel: `posters/22/${VID}.jpg`,
    },
  ]).uuid
  uuids.text = repos.items.insertWithMedia({ kind: 'tweet', source: 'x' }, []).uuid
  await writeImg(`items/11/${IMG}.webp`, 'webp')
  await writeImg(`posters/22/${VID}.jpg`, 'jpeg')
})

beforeEach(() => {
  resetLibraryContextForTests()
  setActiveLibrary(lib)
  resetMediaWorkerAccessForTests()
  toPngCalls.length = 0
  const mw = {
    call: vi.fn(async (op: string, args: { abs: string; maxEdge?: number }) => {
      expect(op).toBe('toPng')
      toPngCalls.push(args)
      return toPng(args, { sips: '/usr/bin/sips' })
    }),
  } as unknown as MediaWorker
  provideMediaWorker(() => mw)
  vi.clearAllMocks()
})

afterAll(() => {
  resetLibraryContextForTests()
  resetMediaWorkerAccessForTests()
  db.close()
})

describe('system.copyImage', () => {
  it('webp : toPng (sharp) puis ClipboardItem image/png non vide', async () => {
    const r = await call('system.copyImage', { itemUuid: uuids.image })
    expect(r).toEqual({ ok: true, data: undefined })
    expect(toPngCalls[0]!.abs).toBe(join(lib.root, `items/11/${IMG}.webp`))
    expect(toPngCalls[0]!.maxEdge).toBe(4096)
    expect(electron.clipboard.write).toHaveBeenCalledTimes(1)
    const [items] = electron.clipboard.write.mock.calls[0] as unknown as [
      { items: Record<string, Blob> }[],
    ]
    const blob = items[0]!.items['image/png']!
    expect(blob.type).toBe('image/png')
    const png = Buffer.from(await blob.arrayBuffer())
    const meta = await sharp(png).metadata()
    expect(meta).toMatchObject({ format: 'png', width: 64, height: 48 })
  })

  it('vidéo : le poster est copié', async () => {
    expect((await call('system.copyImage', { itemUuid: uuids.video })).ok).toBe(true)
    expect(toPngCalls[0]!.abs).toBe(join(lib.root, `posters/22/${VID}.jpg`))
  })

  it('post texte → not_found ; sans worker → worker_unavailable', async () => {
    expect(await call('system.copyImage', { itemUuid: uuids.text })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    })
    provideMediaWorker(null)
    expect(await call('system.copyImage', { itemUuid: uuids.image })).toMatchObject({
      ok: false,
      error: { code: 'system.worker_unavailable' },
    })
  })
})

describe('system.* (Finder, liens, Quick Look, édition)', () => {
  it('revealInFinder : original dans le Finder', async () => {
    expect((await call('system.revealInFinder', { itemUuid: uuids.image })).ok).toBe(true)
    expect(electron.shell.showItemInFolder).toHaveBeenCalledWith(
      join(lib.root, `items/11/${IMG}.webp`),
    )
  })

  it('openExternal : http(s) seulement (contrat + défense)', async () => {
    expect((await call('system.openExternal', { url: 'https://example.com/a' })).ok).toBe(true)
    expect(electron.shell.openExternal).toHaveBeenCalledWith('https://example.com/a')
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'recolt://default/x']) {
      expect((await call('system.openExternal', { url })).ok, url).toBe(false)
    }
    expect(electron.shell.openExternal).toHaveBeenCalledTimes(1)
  })

  it('quickLook : previewFile(original, titre) sur la fenêtre de l’émetteur', async () => {
    const win = { previewFile: vi.fn() }
    electron.BrowserWindow.fromWebContents.mockReturnValue(win)
    const sender = { id: 1 }
    expect((await call('system.quickLook', { itemUuid: uuids.image }, { sender })).ok).toBe(true)
    expect(electron.BrowserWindow.fromWebContents).toHaveBeenCalledWith(sender)
    expect(win.previewFile).toHaveBeenCalledWith(
      join(lib.root, `items/11/${IMG}.webp`),
      'Plage : été/2026',
    )
  })

  it('edit : appelle webContents.<cmd>() de l’émetteur', async () => {
    const sender = {
      isDestroyed: () => false,
      undo: vi.fn(),
      redo: vi.fn(),
      selectAll: vi.fn(),
      cut: vi.fn(),
      copy: vi.fn(),
      paste: vi.fn(),
    }
    for (const cmd of ['undo', 'redo', 'selectAll', 'cut', 'copy', 'paste'] as const) {
      expect((await call('system.edit', { cmd }, { sender })).ok).toBe(true)
      expect(sender[cmd]).toHaveBeenCalledTimes(1)
    }
    expect((await call('system.edit', { cmd: 'reload' }, { sender })).ok).toBe(false)
  })

  it('copyText', async () => {
    expect((await call('system.copyText', { text: 'bonjour' })).ok).toBe(true)
    expect(electron.clipboard.writeText).toHaveBeenCalledWith('bonjour')
  })

  it('openLogs : ouvre le dossier du journal', async () => {
    expect((await call('system.openLogs')).ok).toBe(true)
    expect(electron.shell.openPath).toHaveBeenCalledWith('/tmp/recolt-logs-test')
  })

  it('appInfo : versions', async () => {
    const r = await call('system.appInfo')
    expect(r).toMatchObject({ ok: true, data: { version: '0.0.0', isPackaged: false } })
  })
})

describe('system.saveAs', () => {
  it('copie l’original à l’endroit choisi, nom proposé depuis le titre', async () => {
    const dest = join(makeTmpDir('recolt-saveas-'), 'copie.webp')
    electron.BrowserWindow.fromWebContents.mockReturnValue(null)
    electron.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: dest })
    const r = await call('system.saveAs', { itemUuid: uuids.image })
    expect(r).toEqual({ ok: true, data: { path: dest } })
    const opts = electron.dialog.showSaveDialog.mock.calls[0]![0] as { defaultPath: string }
    expect(opts.defaultPath).toBe('/Users/test/Downloads/Plage été 2026.webp')
    expect((await sharp(dest).metadata()).format).toBe('webp')
  })

  it('annulé → null', async () => {
    electron.dialog.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })
    expect(await call('system.saveAs', { itemUuid: uuids.image })).toEqual({ ok: true, data: null })
  })

  it('suggestedFileName : sans séparateur, ni point initial ; repli sur le nom du fichier', () => {
    expect(suggestedFileName('a/b:c\u0000d', '/x/y.jpg')).toBe('a b c d.jpg')
    expect(suggestedFileName('...cache', '/x/y.jpg')).toBe('cache.jpg')
    expect(suggestedFileName(null, '/x/uuid.mp4')).toBe('uuid.mp4')
    expect(suggestedFileName('  ', '/x/uuid.mp4')).toBe('uuid.mp4')
  })
})

describe('system.redetectTools', () => {
  it('détection neuve, mise en cache dans prefs.tools, renvoie les chemins', async () => {
    const store = createPrefsStore({ file: join(makeTmpDir('recolt-prefs-'), 'prefs.json') })
    setPrefsStore(store)
    try {
      const r = await call('system.redetectTools')
      expect(r).toMatchObject({
        ok: true,
        data: { ffmpeg: '/opt/homebrew/bin/ffmpeg', ffprobe: '/opt/homebrew/bin/ffprobe' },
      })
      expect(store.get().tools.ffmpeg).toBe('/opt/homebrew/bin/ffmpeg')
    } finally {
      setPrefsStore(null)
    }
  })
})
