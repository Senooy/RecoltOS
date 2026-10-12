import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { startRemoteServer } from './remote-server'
import { findFfmpeg, makeImage, makeVideo, writeImage } from './synthetic-media'
import { makeTmpDir, removeTmpDir, withTmpDir } from './tmpdir'
import { makeClock } from './clock'

describe('synthetic-media', () => {
  it('webp / jpeg / png at the requested dimensions, non-uniform gradient', async () => {
    for (const format of ['webp', 'jpeg', 'png'] as const) {
      const meta = await sharp(await makeImage({ width: 40, height: 30, format })).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual([format, 40, 30])
    }
    const flat = await sharp(await makeImage({ color: '#ff0000' })).stats()
    const grad = await sharp(
      await makeImage({ color: '#ff0000', to: '#0000ff', format: 'png' }),
    ).stats()
    expect(flat.channels[0]?.stdev ?? 99).toBeLessThan(2)
    expect(grad.channels[0]?.stdev ?? 0).toBeGreaterThan(20)
  })

  it('writeImage writes into a created subfolder', async () => {
    await withTmpDir(async (dir) => {
      const f = join(dir, 'a', 'b.webp')
      const n = await writeImage(f)
      expect(statSync(f).size).toBe(n)
    })
  })

  it('makeVideo: 3 s mp4 with system ffmpeg, otherwise false', () => {
    const dir = makeTmpDir('video')
    const f = join(dir, 'v.mp4')
    const ok = makeVideo(f)
    expect(ok).toBe(findFfmpeg() !== null)
    if (ok) expect(statSync(f).size).toBeGreaterThan(500)
    else expect(existsSync(f)).toBe(false)
    removeTmpDir(dir)
  })
})

describe('remote-server', () => {
  it('serves avatars and media, 403 expired, 404, request log', async () => {
    const srv = await startRemoteServer()
    try {
      const avatar = await fetch(srv.url('/avatar/auteur_001.jpg'))
      expect(avatar.status).toBe(200)
      expect(avatar.headers.get('content-type')).toBe('image/jpeg')
      const meta = await sharp(Buffer.from(await avatar.arrayBuffer())).metadata()
      expect(meta.width).toBe(64)
      expect((await fetch(srv.url('/expired/a.jpg'))).status).toBe(403)
      expect((await fetch(srv.url('/missing/a.jpg'))).status).toBe(404)
      expect(srv.requests.map((r) => r.url)).toEqual([
        '/avatar/auteur_001.jpg',
        '/expired/a.jpg',
        '/missing/a.jpg',
      ])
    } finally {
      await srv.close()
    }
  })
})

describe('tmpdir / clock / network guard', () => {
  it('temporary folders live under .tmp/tests in the repo', () => {
    const d = makeTmpDir('x')
    expect(d).toMatch(/\.tmp\/tests\/x-/)
    removeTmpDir(d)
    expect(existsSync(d)).toBe(false)
  })

  it('injected clock', () => {
    const c = makeClock(1000)
    expect(c.advance(500)).toBe(1500)
    c.set(10)
    expect(c.now()).toBe(10)
  })

  it('fetch refuses an external host (tests/setup/node.ts)', async () => {
    await expect(fetch('https://pbs.twimg.com/profile_images/x.jpg')).rejects.toThrow(
      /External network forbidden/,
    )
  })

  it('fake scripts are executable', () => {
    const f = join(import.meta.dirname, 'fake-bin', 'claude')
    expect(statSync(f).mode & 0o111).not.toBe(0)
    expect(readFileSync(f, 'utf8')).toContain('--bare')
  })
})
