/**
 * e2e (Playwright `e2e` project, pattern `e2e/*.spec.ts`): the `recolt://` protocol as seen by the
 * REAL renderer of the app (production CSP, `file://` origin), on the demo library
 * (3 s synthetic mp4s, webp):
 *  - fetch with Range: 206 + `Content-Range`, `bytes=-500`, 416 out of range, 403 outside roots;
 *  - video seek: `<video src="recolt://…">`, `currentTime = 2` → `seeked`, decoded image;
 *  - canvas not "tainted" after drawing a `recolt://` thumbnail with `crossorigin="anonymous"`;
 *  - `system.copyImage` of a webp: the clipboard contains a non-empty PNG image.
 *    WARNING: this test writes to the system clipboard; it restores its content afterwards.
 * Dragging to the Finder and the visible opening of Quick Look remain checked by hand.
 */
import { assetUrl } from '../../../../src/main/protocol/urls'
import { findFfmpeg } from '../../../helpers/synthetic-media'
import { expect, test } from '../../../helpers/e2e-fixtures'

interface MediaPick {
  uuid: string
  file_rel: string
  thumb_rel: string | null
  derive_version: number
}

test.use({
  demoLibrary: { count: 24, collections: 1 },
  // The test deliberately causes a 403 (`tmp/` root) and a 416 (range outside the file):
  // Chromium logs them as `console.error` "Failed to load resource".
  allowErrors: [/Failed to load resource: .*status of (403|416)\b/],
})

test.skip(!findFfmpeg(), 'ffmpeg missing: the demo has no readable mp4')

test('recolt:// in the renderer: Range, video seek, CORS canvas, image copy', async ({
  app,
  page,
  openDbReadonly,
  collectErrors,
}) => {
  await expect(page.locator('#root > *').first()).toBeVisible()
  const db = openDbReadonly()
  const pick = (type: 'video' | 'image'): MediaPick =>
    db
      .prepare(
        `SELECT i.uuid, m.file_rel, m.thumb_rel, m.derive_version
           FROM items i JOIN item_media m ON m.id = i.cover_media_id
          WHERE m.media_type = ? AND m.file_rel IS NOT NULL AND m.thumb_rel IS NOT NULL
            AND i.deleted_at IS NULL
          ORDER BY i.id LIMIT 1`,
      )
      .get(type) as MediaPick
  const video = pick('video')
  const image = pick('image')
  expect(video, 'the demo contains a video').toBeTruthy()
  expect(image.file_rel).toMatch(/\.webp$/)
  const videoUrl = assetUrl('default', video.file_rel, video.derive_version)
  const thumbUrl = assetUrl('default', image.thumb_rel!, image.derive_version)

  // 1. Range from the renderer (fetch, connect-src recolt:).
  const ranges = await page.evaluate(async (url) => {
    const probe = async (range?: string) => {
      const r = await fetch(url, range ? { headers: { Range: range } } : {})
      const body = await r.arrayBuffer()
      return {
        status: r.status,
        contentRange: r.headers.get('content-range'),
        length: body.byteLength,
        cors: r.headers.get('access-control-allow-origin'),
      }
    }
    const full = await probe()
    const forbidden = await fetch(url.replace(/\/items\/.*$/, '/tmp/x.part'))
    return {
      full,
      first: await probe('bytes=0-99'),
      suffix: await probe('bytes=-500'),
      outside: await probe(`bytes=${full.length + 10}-`),
      forbidden: forbidden.status,
    }
  }, videoUrl)
  const size = ranges.full.length
  expect(ranges.full.status).toBe(200)
  expect(size).toBeGreaterThan(1000)
  expect(ranges.first).toMatchObject({
    status: 206,
    contentRange: `bytes 0-99/${size}`,
    length: 100,
    cors: '*',
  })
  expect(ranges.suffix).toMatchObject({
    status: 206,
    contentRange: `bytes ${size - 500}-${size - 1}/${size}`,
    length: 500,
  })
  expect(ranges.outside).toMatchObject({ status: 416, contentRange: `bytes */${size}` })
  expect(ranges.forbidden).toBe(403)

  // 2. Video seek on the 3 s synthetic mp4.
  const seek = await page.evaluate(async (url) => {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.style.cssText = 'position:fixed;left:0;top:0;width:64px;height:64px'
    document.body.appendChild(v)
    const once = (ev: string) =>
      new Promise<void>((resolve, reject) => {
        v.addEventListener(ev, () => resolve(), { once: true })
        v.addEventListener('error', () => reject(new Error(`video error ${v.error?.code}`)), {
          once: true,
        })
      })
    const loaded = once('loadedmetadata')
    v.src = url
    await loaded
    const seeks: { target: number; currentTime: number; readyState: number }[] = []
    for (const target of [2, 0.5, 2.5]) {
      const done = once('seeked')
      v.currentTime = target
      await done
      seeks.push({ target, currentTime: v.currentTime, readyState: v.readyState })
    }
    const result = { duration: v.duration, seeks, width: v.videoWidth }
    v.remove()
    return result
  }, videoUrl)
  expect(seek.duration).toBeGreaterThan(2.8)
  expect(seek.duration).toBeLessThan(3.2)
  expect(seek.width).toBeGreaterThan(0)
  for (const s of seek.seeks) {
    expect(Math.abs(s.currentTime - s.target), `seek ${s.target}`).toBeLessThan(0.15)
    expect(s.readyState, `seek ${s.target}`).toBeGreaterThanOrEqual(2)
  }

  // 3. Canvas: CORS → not "tainted" (control: without crossorigin, the image stays opaque).
  const canvas = await page.evaluate(async (url) => {
    const draw = async (crossOrigin: string | null) => {
      const img = new Image()
      if (crossOrigin !== null) img.crossOrigin = crossOrigin
      img.src = `${url}${url.includes('?') ? '&' : '?'}c=${crossOrigin ?? 'none'}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = 128
      c.height = 128
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0, 128, 128)
      try {
        const px = ctx.getImageData(64, 64, 1, 1).data
        return { tainted: false, alpha: px[3], dataUrlLength: c.toDataURL('image/png').length }
      } catch (e) {
        return { tainted: true, error: String(e) }
      }
    }
    return { anonymous: await draw('anonymous'), control: await draw(null) }
  }, thumbUrl)
  expect(canvas.anonymous.tainted).toBe(false)
  expect(canvas.anonymous.alpha).toBe(255)
  expect(canvas.anonymous.dataUrlLength).toBeGreaterThan(200)
  expect(canvas.control.tainted).toBe(true)

  // 4. system.copyImage of a webp → non-empty PNG image in the clipboard (restored afterwards).
  await app.evaluate(async ({ clipboard }) => {
    const g = globalThis as unknown as { __savedClipboard?: unknown }
    g.__savedClipboard = await clipboard.read().catch(() => null)
  })
  try {
    const res = await page.evaluate(
      (uuid) =>
        (
          window as unknown as {
            recolt: { invoke(c: string, i: unknown): Promise<{ ok: boolean; error?: unknown }> }
          }
        ).recolt.invoke('system.copyImage', { itemUuid: uuid }),
      image.uuid,
    )
    expect(res).toEqual({ ok: true, data: undefined })
    const pasted = await app.evaluate(async ({ clipboard, nativeImage }) => {
      const items = await clipboard.read()
      const types = items.flatMap((i) => i.types)
      const item = items.find((i) => i.types.includes('image/png'))
      if (!item) return { types, size: null }
      const blob = (await item.getType('image/png')) as Blob
      const img = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()))
      return { types, size: img.getSize(), empty: img.isEmpty() }
    })
    expect(pasted.types).toContain('image/png')
    expect(pasted.empty).toBe(false)
    expect(pasted.size!.width).toBeGreaterThan(0)
    expect(pasted.size!.height).toBeGreaterThan(0)
  } finally {
    await app.evaluate(async ({ clipboard }) => {
      const g = globalThis as unknown as { __savedClipboard?: Electron.ClipboardItem[] | null }
      if (g.__savedClipboard && g.__savedClipboard.length > 0) {
        await clipboard.write(g.__savedClipboard).catch(() => undefined)
      } else {
        // Clipboard was empty originally: do not leave the test's PNG in it.
        clipboard.clear()
      }
    })
  }

  expect(await collectErrors()).toEqual([])
})
