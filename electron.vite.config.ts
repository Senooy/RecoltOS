/**
 * electron-vite (QA §4.4, PLAN §1.14) : main et preload en CJS, preload isolé et autonome
 * (sandbox), renderer React + Tailwind avec CSP injectée (sans `https:`, PLAN §1.7).
 */
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

const root = import.meta.dirname
const alias = {
  '@shared': resolve(root, 'src/shared'),
  '@main': resolve(root, 'src/main'),
  '@renderer': resolve(root, 'src/renderer/src'),
}
const watchIgnored = ['**/.worktrees/**', '**/.tmp/**', '**/out/**', '**/dist/**']

/** CSP de production (QA §4.5 avec le schéma `recolt:` ; aucune origine http(s) distante). */
export const CSP_PROD = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' recolt: data: blob:",
  "media-src 'self' recolt: blob:",
  "font-src 'self' data:",
  "connect-src 'self' recolt:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join('; ')

/** Dev : préambule react-refresh (`'unsafe-inline'`) et WebSocket HMR local. */
export const CSP_DEV = CSP_PROD.replace(
  "script-src 'self'",
  "script-src 'self' 'unsafe-inline'",
).replace("connect-src 'self' recolt:", "connect-src 'self' recolt: ws://localhost:*")

function htmlCsp(): Plugin {
  let isDev = false
  return {
    name: 'recolt-html-csp',
    configResolved(c) {
      isDev = c.command === 'serve'
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const csp = isDev ? CSP_DEV : CSP_PROD
        return html.replace(
          '<!-- CSP -->',
          `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        )
      },
    },
  }
}

/**
 * Images factices du mode maquette (`api/mock.ts`, dev uniquement) : `recolt://mock/<root>/<n>.svg`
 * est traduit par `lib/media-url.ts` en `/__mock/media/<root>/<n>.svg?w=&h=&c=` (même origine, CSP `'self'`).
 */
function mockMedia(): Plugin {
  return {
    name: 'recolt-mock-media',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__mock/media', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://mock.local')
        const w = Math.min(4000, Math.max(16, Number(url.searchParams.get('w')) || 800))
        const h = Math.min(4000, Math.max(16, Number(url.searchParams.get('h')) || 600))
        const c = /^[0-9a-f]{6}$/i.test(url.searchParams.get('c') ?? '')
          ? url.searchParams.get('c')
          : 'd8d4cc'
        const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
          `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
          `<stop offset="0" stop-color="#${c}"/><stop offset="1" stop-color="#${c}" stop-opacity=".55"/>` +
          `</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`
        res.setHeader('Content-Type', 'image/svg+xml')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(svg)
      })
    },
  }
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      outDir: 'out/main',
      // Deux entrées : le main et le worker média (utilityProcess, WP-03 → out/main/media.worker.js).
      rollupOptions: {
        input: {
          index: resolve(root, 'src/main/index.ts'),
          'media.worker': resolve(root, 'src/main/workers/media.worker.ts'),
        },
      },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      outDir: 'out/preload',
      // Entrée unique : bundle autonome sans chunk partagé. `isolatedEntries: true` (QA §4.4) est
      // inutile ici et casse le build hors TTY (electron-vite 5.0.0 appelle
      // `process.stdout.moveCursor` sans vérifier `isTTY`). À réactiver si une 2e entrée apparaît.
      isolatedEntries: false,
      externalizeDeps: false,
      rollupOptions: { input: { index: resolve(root, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    resolve: { alias },
    plugins: [react(), tailwindcss(), htmlCsp(), mockMedia()],
    server: { watch: { ignored: watchIgnored } },
    build: {
      outDir: resolve(root, 'out/renderer'),
      rollupOptions: {
        input: {
          index: resolve(root, 'src/renderer/index.html'),
          offscreen: resolve(root, 'src/renderer/offscreen.html'),
        },
      },
    },
  },
})
