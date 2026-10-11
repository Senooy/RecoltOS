/**
 * WP-05 — handler `recolt://` (ARCHI §2.5, PLAN §1.7), appelé avec des `Request` Node :
 * 200 / HEAD / 206 + `Content-Range`, `bytes=-500`, 416, `..` et `\0` → 403, racine inconnue → 403,
 * lien symbolique sortant → 403, bibliothèque inconnue → 404, cache `immutable` si `?v`, CORS.
 */
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createRecoltHandler,
  parseRecoltPath,
  type RecoltHandler,
} from '../../../src/main/protocol/recolt-protocol'
import { makeTmpDir } from '../../helpers/tmpdir'

const SIZE = 2000
const BYTES = Buffer.from(Array.from({ length: SIZE }, (_, i) => i % 251))
const UUID = '0d5e1f7a-2b3c-4d5e-8f90-123456789abc'
const VIDEO = `items/0d/${UUID}.mp4`
const THUMB = `thumbs/0d/${UUID}.webp`

let base: string
let root: string
let handler: RecoltHandler
const denied: string[] = []

beforeAll(() => {
  base = makeTmpDir('recolt-protocol-')
  root = join(base, 'lib')
  for (const rel of [VIDEO, THUMB]) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), BYTES)
  }
  writeFileSync(join(root, 'recolt.db'), 'base')
  mkdirSync(join(root, 'snapshots'), { recursive: true })
  writeFileSync(join(root, 'snapshots', 'recolt-1.db'), 'snapshot')
  mkdirSync(join(root, 'items', 'em'), { recursive: true })
  writeFileSync(join(root, 'items', 'em', 'empty.mp4'), '')
  // Secret hors de la bibliothèque, et liens symboliques qui tentent d'y mener.
  writeFileSync(join(base, 'secret.txt'), 'secret')
  symlinkSync(join(base, 'secret.txt'), join(root, 'thumbs', '0d', 'evil.webp'))
  symlinkSync(join(root, 'recolt.db'), join(root, 'thumbs', '0d', 'db.webp'))
  symlinkSync(join(root, VIDEO), join(root, 'thumbs', '0d', 'alias.mp4'))
  mkdirSync(join(root, 'thumbs', 'dir.webp'), { recursive: true })
  handler = createRecoltHandler({
    libraryFor: (id) => (id === 'default' ? { id, root } : null),
    onDenied: (reason) => denied.push(reason),
  })
})

afterAll(() => {
  vi.restoreAllMocks()
})

const get = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  handler(new Request(`recolt://default/${path}`, { method, headers }))

async function bodyOf(res: Response): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer())
}

describe('recolt:// — réponses', () => {
  it('200 complet, type MIME, CORS, Accept-Ranges', async () => {
    const res = await get(VIDEO)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect(res.headers.get('content-length')).toBe(String(SIZE))
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await bodyOf(res)).equals(BYTES)).toBe(true)
  })

  it('Cache-Control : immutable avec ?v, no-cache sans', async () => {
    const withV = await get(`${THUMB}?v=3`)
    expect(withV.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(withV.headers.get('content-type')).toBe('image/webp')
    await withV.arrayBuffer()
    const withoutV = await get(THUMB)
    expect(withoutV.headers.get('cache-control')).toBe('no-cache')
    await withoutV.arrayBuffer()
  })

  it('HEAD : mêmes en-têtes, aucun corps', async () => {
    const res = await get(VIDEO, {}, 'HEAD')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe(String(SIZE))
    expect(res.body).toBeNull()
    const ranged = await get(VIDEO, { Range: 'bytes=10-19' }, 'HEAD')
    expect(ranged.status).toBe(206)
    expect(ranged.headers.get('content-range')).toBe(`bytes 10-19/${SIZE}`)
    expect(ranged.headers.get('content-length')).toBe('10')
    expect(ranged.body).toBeNull()
  })

  it.each([
    ['bytes=0-99', 0, 99],
    ['bytes=100-', 100, SIZE - 1],
    ['bytes=0-0', 0, 0],
    ['bytes=-500', SIZE - 500, SIZE - 1],
    ['bytes=1990-99999', 1990, SIZE - 1],
  ])('Range %s → 206, Content-Range et octets exacts', async (range, start, end) => {
    const res = await get(VIDEO, { Range: range })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes ${start}-${end}/${SIZE}`)
    expect(res.headers.get('content-length')).toBe(String(end - start + 1))
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    const body = await bodyOf(res)
    expect(body.equals(BYTES.subarray(start, end + 1))).toBe(true)
  })

  it.each(['bytes=2000-', 'bytes=5000-6000', 'bytes=50-10', 'bytes=-0', 'bytes=0-1,4-5'])(
    'Range %s hors plage → 416 avec Content-Range bytes */taille',
    async (range) => {
      const res = await get(VIDEO, { Range: range })
      expect(res.status).toBe(416)
      expect(res.headers.get('content-range')).toBe(`bytes */${SIZE}`)
    },
  )

  it('fichier vide : 200 et longueur 0 sans flux', async () => {
    const res = await get('items/em/empty.mp4')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('0')
    expect((await bodyOf(res)).length).toBe(0)
  })

  it('lien symbolique interne entre racines servies : autorisé', async () => {
    const res = await get('thumbs/0d/alias.mp4', { Range: 'bytes=0-9' })
    expect(res.status).toBe(206)
    expect((await bodyOf(res)).equals(BYTES.subarray(0, 10))).toBe(true)
  })

  it('OPTIONS : pré-vol CORS (Range autorisé)', async () => {
    const res = await get(VIDEO, {}, 'OPTIONS')
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-headers')).toBe('Range')
  })

  it('POST → 405', async () => {
    const res = await get(VIDEO, {}, 'POST')
    expect(res.status).toBe(405)
  })
})

describe('recolt:// — refus', () => {
  it.each([
    ['..', 'thumbs/../../secret.txt'],
    ['%2e%2e', 'thumbs/%2e%2e/%2e%2e/secret.txt'],
    ['..%2F', 'thumbs/..%2F..%2Fsecret.txt'],
    ['%2F absolu', 'thumbs/%2F..%2Fsecret.txt'],
    ['NUL', 'thumbs/0d/x%00.webp'],
    ['antislash', 'thumbs/0d%5C..%5C..%5Csecret.txt'],
    ['segment vide', 'thumbs//0d/x.webp'],
    ['racine inconnue', 'etc/passwd'],
    ['snapshots', 'snapshots/recolt-1.db'],
    ['tmp', 'tmp/x.part'],
    ['import', 'import/moodmark.db'],
    ['base', 'recolt.db'],
    ['racine seule', 'thumbs'],
    ['encodage invalide', 'thumbs/%E0%A4%A'],
  ])('%s → 403', async (_label, path) => {
    const res = await get(path)
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('lien symbolique vers un fichier hors de la bibliothèque → 403', async () => {
    expect((await get('thumbs/0d/evil.webp')).status).toBe(403)
  })

  it('lien symbolique vers la base (hors racines servies) → 403', async () => {
    expect((await get('thumbs/0d/db.webp')).status).toBe(403)
  })

  it('bibliothèque inconnue ou fichier absent → 404', async () => {
    expect((await handler(new Request(`recolt://autre/${VIDEO}`))).status).toBe(404)
    expect((await get('thumbs/0d/absent.webp')).status).toBe(404)
    expect((await get('thumbs/dir.webp')).status).toBe(404)
  })

  it('les refus sont signalés au journal', () => {
    expect(denied.length).toBeGreaterThan(0)
    expect(denied).toContain('racine inconnue')
  })
})

describe('parseRecoltPath', () => {
  it('décode et valide', () => {
    expect(parseRecoltPath('/thumbs/0d/a%20b.webp')).toEqual({ rel: 'thumbs/0d/a b.webp' })
    expect(parseRecoltPath('/avatars/x/k.jpg')).toEqual({ rel: 'avatars/x/k.jpg' })
    expect(parseRecoltPath('/thumbs/a/../b')).toHaveProperty('denied')
    expect(parseRecoltPath('/thumbs/a/./b')).toHaveProperty('denied')
  })
})
