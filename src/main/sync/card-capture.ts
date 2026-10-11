/**
 * Capture Electron de la carte de post (fenêtre hors écran, ERRATA §B) pour `tweet-card-renderer`.
 */
import { offscreenUrl, withOffscreenWindow } from '../windows/offscreen'
import { CARD_CSS_WIDTH, type CardCapture } from './tweet-card-renderer'

export async function captureCardElectron(data: string): Promise<CardCapture> {
  return withOffscreenWindow({ width: CARD_CSS_WIDTH * 2 + 40, height: 2400 }, async (win) => {
    await win.loadURL(offscreenUrl('tweet-card', { data, theme: 'light' }))
    const wc = win.webContents
    for (let i = 0; i < 100; i++) {
      const ready = (await wc.executeJavaScript('document.body.dataset.ready === "1"')) as boolean
      if (ready) break
      await new Promise((r) => setTimeout(r, 50))
    }
    const rect = (await wc.executeJavaScript(
      'JSON.stringify((() => { const r = document.querySelector("[data-card-root]").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })())',
    )) as string
    const r = JSON.parse(rect) as { x: number; y: number; width: number; height: number }
    const img = await wc.capturePage({
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.ceil(r.height),
    })
    const size = img.getSize()
    return { png: img.toPNG(), width: size.width, height: size.height }
  })
}
