/**
 * e2e (projet Playwright `e2e`, motif `e2e/*.spec.ts`) : le protocole `recolt://` vu par le
 * VRAI renderer de l'app (CSP de production, origine `file://`), sur la bibliothèque de démo
 * (mp4 synthétiques de 3 s, webp) :
 *  - fetch avec Range : 206 + `Content-Range`, `bytes=-500`, 416 hors plage, 403 hors racines ;
 *  - seek vidéo : `<video src="recolt://…">`, `currentTime = 2` → `seeked`, image décodée ;
 *  - canvas non « tainted » après dessin d'une vignette `recolt://` en `crossorigin="anonymous"` ;
 *  - `system.copyImage` d'un webp : le presse-papiers contient une image PNG non vide.
 *    ATTENTION : ce test écrit dans le presse-papiers du système ; il restaure son contenu ensuite.
 * Le glisser vers le Finder et l'ouverture visible de Quick Look restent vérifiés à la main.
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
  // Le test provoque volontairement un 403 (racine `tmp/`) et un 416 (plage hors fichier) :
  // Chromium les journalise en `console.error` « Failed to load resource ».
  allowErrors: [/Failed to load resource: .*status of (403|416)\b/],
})

test.skip(!findFfmpeg(), 'ffmpeg absent : la démo n’a pas de mp4 lisible')

test('recolt:// dans le renderer : Range, seek vidéo, canvas CORS, copie d’image', async ({
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
  expect(video, 'la démo contient une vidéo').toBeTruthy()
  expect(image.file_rel).toMatch(/\.webp$/)
  const videoUrl = assetUrl('default', video.file_rel, video.derive_version)
  const thumbUrl = assetUrl('default', image.thumb_rel!, image.derive_version)

  // 1. Range depuis le renderer (fetch, connect-src recolt:).
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

  // 2. Seek vidéo sur le mp4 synthétique de 3 s.
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

  // 3. Canvas : CORS → non « tainted » (témoin : sans crossorigin, l'image reste opaque).
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

  // 4. system.copyImage d'un webp → image PNG non vide dans le presse-papiers (restauré ensuite).
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
        // Presse-papiers vide à l'origine : on n'y laisse pas le PNG du test.
        clipboard.clear()
      }
    })
  }

  expect(await collectErrors()).toEqual([])
})
