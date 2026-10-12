/**
 * `recolt://` handler, called with Node `Request`s:
 * 200 / HEAD / 206 + `Content-Range`, `bytes=-500`, 416, `..` and `\0` → 403, unknown root → 403,
 * outgoing symbolic link → 403, unknown library → 404, `immutable` cache if `?v`, CORS.
 */
import {
  mkdirSync,
  promises as fsPromises,
  symlinkSync,
  writeFileSync,
  type Mode,
  type OpenMode,
  type PathLike,
} from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
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
  // Secret outside the library, and symbolic links trying to lead there.
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

describe('recolt:// — responses', () => {
  it('200 complete, MIME type, CORS, Accept-Ranges', async () => {
    const res = await get(VIDEO)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect(res.headers.get('content-length')).toBe(String(SIZE))
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await bodyOf(res)).equals(BYTES)).toBe(true)
  })

  it('Cache-Control: immutable with ?v, no-cache without', async () => {
    const withV = await get(`${THUMB}?v=3`)
    expect(withV.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(withV.headers.get('content-type')).toBe('image/webp')
    await withV.arrayBuffer()
    const withoutV = await get(THUMB)
    expect(withoutV.headers.get('cache-control')).toBe('no-cache')
    await withoutV.arrayBuffer()
  })

  it('HEAD: same headers, no body', async () => {
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
  ])('Range %s → 206, Content-Range and exact bytes', async (range, start, end) => {
    const res = await get(VIDEO, { Range: range })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes ${start}-${end}/${SIZE}`)
    expect(res.headers.get('content-length')).toBe(String(end - start + 1))
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    const body = await bodyOf(res)
    expect(body.equals(BYTES.subarray(start, end + 1))).toBe(true)
  })

  it.each(['bytes=2000-', 'bytes=5000-6000', 'bytes=50-10', 'bytes=-0', 'bytes=0-1,4-5'])(
    'Range %s out of range → 416 with Content-Range bytes */size',
    async (range) => {
      const res = await get(VIDEO, { Range: range })
      expect(res.status).toBe(416)
      expect(res.headers.get('content-range')).toBe(`bytes */${SIZE}`)
    },
  )

  it('empty file: 200 and length 0 without stream', async () => {
    const res = await get('items/em/empty.mp4')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('0')
    expect((await bodyOf(res)).length).toBe(0)
  })

  it('internal symbolic link between served roots: allowed', async () => {
    const res = await get('thumbs/0d/alias.mp4', { Range: 'bytes=0-9' })
    expect(res.status).toBe(206)
    expect((await bodyOf(res)).equals(BYTES.subarray(0, 10))).toBe(true)
  })

  it('OPTIONS: CORS preflight (Range allowed)', async () => {
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

describe('recolt:// — refusals', () => {
  it.each([
    ['..', 'thumbs/../../secret.txt'],
    ['%2e%2e', 'thumbs/%2e%2e/%2e%2e/secret.txt'],
    ['..%2F', 'thumbs/..%2F..%2Fsecret.txt'],
    ['%2F absolute', 'thumbs/%2F..%2Fsecret.txt'],
    ['NUL', 'thumbs/0d/x%00.webp'],
    ['backslash', 'thumbs/0d%5C..%5C..%5Csecret.txt'],
    ['empty segment', 'thumbs//0d/x.webp'],
    ['unknown root', 'etc/passwd'],
    ['snapshots', 'snapshots/recolt-1.db'],
    ['tmp', 'tmp/x.part'],
    ['import', 'import/moodmark.db'],
    ['base', 'recolt.db'],
    ['root only', 'thumbs'],
    ['invalid encoding', 'thumbs/%E0%A4%A'],
  ])('%s → 403', async (_label, path) => {
    const res = await get(path)
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('symbolic link to a file outside the library → 403', async () => {
    expect((await get('thumbs/0d/evil.webp')).status).toBe(403)
  })

  it('symbolic link to the database (outside served roots) → 403', async () => {
    expect((await get('thumbs/0d/db.webp')).status).toBe(403)
  })

  it('unknown library or missing file → 404', async () => {
    expect((await handler(new Request(`recolt://autre/${VIDEO}`))).status).toBe(404)
    expect((await get('thumbs/0d/absent.webp')).status).toBe(404)
    expect((await get('thumbs/dir.webp')).status).toBe(404)
  })

  it('refusals are reported to the log', () => {
    expect(denied.length).toBeGreaterThan(0)
    expect(denied).toContain('racine inconnue')
  })
})

describe('parseRecoltPath', () => {
  it('decodes and validates', () => {
    expect(parseRecoltPath('/thumbs/0d/a%20b.webp')).toEqual({ rel: 'thumbs/0d/a b.webp' })
    expect(parseRecoltPath('/avatars/x/k.jpg')).toEqual({ rel: 'avatars/x/k.jpg' })
    expect(parseRecoltPath('/thumbs/a/../b')).toHaveProperty('denied')
    expect(parseRecoltPath('/thumbs/a/./b')).toHaveProperty('denied')
  })
})

describe('recolt:// — request cancellation', () => {
  // Larger than the stream's highWaterMark (64 KiB): without reading, the stream stops and keeps the handle.
  const BIG = 'items/0d/big.mp4'
  beforeAll(() => {
    writeFileSync(join(root, BIG), Buffer.alloc(256 * 1024, 7))
  })

  /** Spies on the handles opened by the handler, without changing their behavior. */
  function spyOpenedHandles(): { handles: FileHandle[]; restore(): void } {
    const handles: FileHandle[] = []
    const realOpen = fsPromises.open
    const spy = vi
      .spyOn(fsPromises, 'open')
      .mockImplementation(async (file: PathLike, flags?: OpenMode, mode?: Mode) => {
        const h = await realOpen(file, flags, mode)
        handles.push(h)
        return h
      })
    return { handles, restore: () => spy.mockRestore() }
  }

  it('signal abort while an unread body: the handle is closed', async () => {
    const spied = spyOpenedHandles()
    try {
      const ac = new AbortController()
      const res = await handler(new Request(`recolt://default/${BIG}`, { signal: ac.signal }))
      expect(res.status).toBe(200)
      const handle = spied.handles.at(-1)!
      expect(handle.fd).not.toBe(-1)
      ac.abort()
      await vi.waitFor(() => expect(handle.fd).toBe(-1))
    } finally {
      spied.restore()
    }
  })

  it('signal already cancelled before reading: 499 and handle closed', async () => {
    const spied = spyOpenedHandles()
    try {
      const ac = new AbortController()
      ac.abort()
      const res = await handler(new Request(`recolt://default/${BIG}`, { signal: ac.signal }))
      expect(res.status).toBe(499)
      const handle = spied.handles.at(-1)!
      await vi.waitFor(() => expect(handle.fd).toBe(-1))
    } finally {
      spied.restore()
    }
  })
})
