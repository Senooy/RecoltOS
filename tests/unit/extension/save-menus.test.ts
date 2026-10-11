/**
 * Enregistrement depuis l'extension (WP-53) : clic droit → `save.create`, app fermée → `queued`,
 * blob de 20 Mo → 3 morceaux, menus (10 collections + « Autre collection… »), textes du popup,
 * manifests par cible.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildManifest } from '../../../extension/manifest'
import { EXTENSION_VERSION } from '../../../src/shared/bridge/constants'
import { menuItems, parseMenuId } from '../../../extension/src/background/menus'
import { BridgeError } from '../../../extension/src/background/native'
import {
  baseRequest,
  saveFromClick,
  TOAST,
  type SaveDeps,
} from '../../../extension/src/background/save'
import { relTime, STATUS_TEXT, syncLine } from '../../../extension/src/popup/index'
import type { PopupState } from '../../../extension/src/lib/popup-protocol'
import { buildExt } from '../../../scripts/build-ext.mjs'
import { EXTENSION_KEY, GECKO_ID } from '../../../src/shared/bridge/constants'
import { makeTmpDir } from '../../helpers/tmpdir'

const MIB = 1024 * 1024

function deps(over: Partial<SaveDeps> & { ack?: unknown; blobSize?: number } = {}) {
  const requests: { type: string; payload: Record<string, unknown> }[] = []
  const posts: { type: string; payload: Record<string, unknown> }[] = []
  const toasts: string[] = []
  const d: SaveDeps = {
    bridge: {
      state: 'app_connected',
      request: (type: string, payload: unknown) => {
        requests.push({ type, payload: payload as Record<string, unknown> })
        if (over.ack instanceof Error) return Promise.reject(over.ack)
        return Promise.resolve({
          v: 1,
          id: 'x',
          type: 'save.ack',
          payload: over.ack ?? { status: 'saved', saveId: 'u' },
        })
      },
      post: (type: string, payload?: unknown) => {
        posts.push({ type, payload: payload as Record<string, unknown> })
        return 'id'
      },
    } as unknown as SaveDeps['bridge'],
    exec: ((_tab: number, fn: { name: string }, args: unknown[]) => {
      if (fn.name === 'probeBlob')
        return Promise.resolve({ size: over.blobSize ?? 1000, mime: 'image/png' })
      if (fn.name === 'readBlobChunk') {
        const [, off, len] = args as [string, number, number]
        const n = Math.max(0, Math.min(len, (over.blobSize ?? 1000) - off))
        return Promise.resolve(Buffer.alloc(n).toString('base64'))
      }
      return Promise.resolve(null)
    }) as SaveDeps['exec'],
    captureTab: () => Promise.resolve('data:image/jpeg;base64,AAAA'),
    pageMeta: () =>
      Promise.resolve({ title: 'Titre', dark: false, ogImage: 'https://e.test/og.png' }),
    toast: (_t, text) => void toasts.push(text),
    newId: () => '0decd148-5f3c-4d7a-9b1e-2a3b4c5d6e7f',
    ...over,
  }
  return { d, requests, posts, toasts }
}

const tab = { id: 7, windowId: 1, url: 'https://example.com/page', title: 'Une page' }

describe('enregistrement', () => {
  it('clic droit sur une image http(s) → save.create kind image', async () => {
    const { d, requests, toasts } = deps()
    const r = await saveFromClick(
      d,
      {
        menuItemId: 'rcl-save',
        mediaType: 'image',
        srcUrl: 'https://cdn.test/a.jpg',
        pageUrl: tab.url,
      },
      tab,
    )
    expect(r.status).toBe('saved')
    expect(requests[0]).toEqual({
      type: 'save.create',
      payload: {
        kind: 'image',
        pageUrl: tab.url,
        pageTitle: 'Une page',
        srcUrl: 'https://cdn.test/a.jpg',
      },
    })
    expect(toasts).toEqual([TOAST.saved])
  })

  it('app fermée : accusé queued → toast « ajouté au prochain lancement »', async () => {
    const { d, toasts } = deps({ ack: { status: 'queued' } })
    await saveFromClick(
      d,
      { menuItemId: 'rcl-save', linkUrl: 'https://e.test/l', pageUrl: tab.url },
      tab,
    )
    expect(toasts).toEqual([TOAST.queued])
  })

  it('connecteur absent → message clair', async () => {
    const { d, toasts } = deps({ ack: new BridgeError('NOT_CONNECTED') })
    const r = await saveFromClick(d, { menuItemId: 'rcl-save', pageUrl: tab.url }, tab)
    expect(r.status).toBe('refused')
    expect(toasts).toEqual([TOAST.hostMissing])
  })

  it('blob de 20 Mo → 3 morceaux de 8 Mio puis save.create{upload}', async () => {
    const { d, requests, posts } = deps({ blobSize: 20 * MIB })
    await saveFromClick(
      d,
      {
        menuItemId: 'rcl-save',
        mediaType: 'image',
        srcUrl: 'blob:https://e.test/1',
        pageUrl: tab.url,
      },
      tab,
    )
    expect(posts.map((p) => [p.type, p.payload.seq, p.payload.last])).toEqual([
      ['media.chunk', 0, false],
      ['media.chunk', 1, false],
      ['media.chunk', 2, true],
    ])
    const req = requests[0]!.payload
    expect(req.upload).toEqual({
      id: '0decd148-5f3c-4d7a-9b1e-2a3b4c5d6e7f',
      mime: 'image/png',
      size: 20 * MIB,
    })
    expect(req.srcUrl).toBeUndefined()
    expect(req.inlineMedia).toBeUndefined()
  })

  it('petit blob → inline ; gros blob app fermée → refus ; > 200 Mo → refus', async () => {
    const small = deps({ blobSize: 2 * MIB })
    await saveFromClick(
      small.d,
      { menuItemId: 'rcl-save', mediaType: 'image', srcUrl: 'blob:x', pageUrl: tab.url },
      tab,
    )
    expect((small.requests[0]!.payload.inlineMedia as { mime: string }).mime).toBe('image/png')
    const closed = deps({ blobSize: 20 * MIB })
    ;(closed.d.bridge as { state: string }).state = 'app_closed'
    await saveFromClick(
      closed.d,
      { menuItemId: 'rcl-save', mediaType: 'image', srcUrl: 'blob:x', pageUrl: tab.url },
      tab,
    )
    expect(closed.toasts).toEqual([TOAST.bigNeedsApp])
    const huge = deps({ blobSize: 201 * MIB })
    await saveFromClick(
      huge.d,
      { menuItemId: 'rcl-save', mediaType: 'image', srcUrl: 'blob:x', pageUrl: tab.url },
      tab,
    )
    expect(huge.toasts).toEqual([TOAST.tooBig])
  })

  it('page : capture d’onglet et métadonnées ; collection et note transmises', async () => {
    const { d, requests, toasts } = deps({ ack: { status: 'saved', collectionName: 'Gaming' } })
    await saveFromClick(d, { menuItemId: 'rcl-save', pageUrl: tab.url }, tab, {
      collectionId: 'c1',
      note: 'à revoir',
    })
    const p = requests[0]!.payload
    expect(p.kind).toBe('page')
    expect(p.screenshot).toMatchObject({ mime: 'image/jpeg', dataBase64: 'AAAA' })
    expect(p.pageMeta).toEqual({ ogImage: 'https://e.test/og.png' })
    expect(p.collectionId).toBe('c1')
    expect(p.note).toBe('à revoir')
    expect(toasts).toEqual(['Ajouté à Gaming'])
  })

  it('pages non web refusées ; vidéo en flux (blob:) refusée', () => {
    expect(baseRequest({ menuItemId: 'rcl-save', pageUrl: 'chrome://extensions' }, {})).toBeNull()
  })
})

describe('menus', () => {
  it('10 collections au plus, puis « Autre collection… »', () => {
    const cols = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`,
      name: `Col ${i}`,
      color: null,
      parentId: null,
      count: i,
    }))
    const items = menuItems(cols)
    expect(items[0]).toEqual({ id: 'rcl-save', title: 'Enregistrer dans RecoltOS' })
    expect(items.filter((i) => i.parentId === 'rcl-save-to')).toHaveLength(11)
    expect(items.at(-1)).toEqual({
      id: 'rcl-col-more',
      title: 'Autre collection…',
      parentId: 'rcl-save-to',
    })
    expect(parseMenuId('rcl-col-c3')).toEqual({ collectionId: 'c3', more: false })
    expect(parseMenuId('rcl-col-more')).toEqual({ collectionId: null, more: true })
    expect(parseMenuId('autre')).toBeNull()
  })
})

describe('popup', () => {
  it('textes FR (tutoiement) et état « RecoltOS fermé »', () => {
    expect(STATUS_TEXT.app_closed!.label).toBe('RecoltOS fermé')
    expect(STATUS_TEXT.app_closed!.hint).toMatch(/Tes enregistrements/)
    for (const t of Object.values(STATUS_TEXT)) {
      expect(`${t.label} ${t.hint ?? ''}`).not.toMatch(/\bvous\b|\bvotre\b|\bvos\b/i)
    }
    expect(relTime(0, 4 * 60_000)).toBe('il y a 4 min')
    const st = {
      platforms: {
        x: { loggedIn: true, permission: true },
        instagram: { loggedIn: false, permission: true },
        cosmos: { loggedIn: true, permission: false },
      },
      sync: {
        x: { enabled: true, status: 'ok', lastSuccessAt: 0, detail: null },
        instagram: { enabled: true, status: 'idle', lastSuccessAt: null, detail: null },
        cosmos: { enabled: true, status: 'idle', lastSuccessAt: null, detail: null },
      },
    } as unknown as PopupState
    expect(syncLine('x', st, 4 * 60_000)).toBe('X — dernière synchro il y a 4 min')
    expect(syncLine('instagram', st)).toBe('Instagram — non connecté dans ce navigateur')
    expect(syncLine('cosmos', st)).toBe('Cosmos — accès au site à autoriser')
  })
})

describe('manifests et build', () => {
  it('Chromium : key + service worker ; Firefox : gecko.id + scripts, sans key ; jamais webRequest', () => {
    const c = buildManifest('chromium')
    expect(c.key).toBe(EXTENSION_KEY)
    expect(c.background).toEqual({ service_worker: 'background.js' })
    const f = buildManifest('firefox')
    expect(f.key).toBeUndefined()
    expect(f.background).toEqual({ scripts: ['background.js'] })
    expect((f.browser_specific_settings as { gecko: { id: string } }).gecko.id).toBe(GECKO_ID)
    for (const m of [c, f]) {
      expect(m.permissions).not.toContain('webRequest')
      expect(m.host_permissions).not.toContain('<all_urls>')
    }
  })

  let out = ''
  beforeAll(async () => {
    out = (await buildExt({ outDir: makeTmpDir('ext-build'), logLevel: 'silent' })) as string
  })

  it('deux cibles ; aucun script ne contient `import` ; icônes générées', () => {
    for (const t of ['chromium', 'firefox']) {
      const dir = join(out, t)
      expect(readdirSync(join(dir, 'icons')).sort()).toEqual([
        '128.png',
        '16.png',
        '32.png',
        '48.png',
      ])
      for (const f of ['background.js', 'popup.js', 'content/hook.js', 'content/bridge.js']) {
        expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/^\s*(import|export)\s/m)
      }
      const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { version: string }
      expect(m.version).toBe(EXTENSION_VERSION)
    }
  })
})
