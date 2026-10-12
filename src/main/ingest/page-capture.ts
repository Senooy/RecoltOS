/**
 * Captures an HTML page: off-screen window 1440×900 (non-persistent
 * partition, sandbox, no preload, `withOffscreenWindow`), title and `og:description`.
 */
import { withOffscreenWindow } from '../windows/offscreen'
import type { PageCapture } from './ingest'

export async function capturePage(url: string): Promise<PageCapture> {
  return withOffscreenWindow({ width: 1440, height: 900, timeoutMs: 20_000 }, async (win) => {
    await win.loadURL(url)
    await new Promise((r) => setTimeout(r, 800))
    const image = await win.webContents.capturePage()
    const meta = (await win.webContents
      .executeJavaScript(
        `(() => { const m = document.querySelector('meta[property="og:description"], meta[name="description"]'); return { title: document.title || null, description: m ? m.getAttribute('content') : null } })()`,
        true,
      )
      .catch(() => ({ title: null, description: null }))) as {
      title: string | null
      description: string | null
    }
    return {
      png: image.toPNG(),
      title: meta.title?.trim() || null,
      description: meta.description?.trim().slice(0, 2000) || null,
    }
  })
}
