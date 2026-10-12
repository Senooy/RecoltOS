/**
 * electron-vite: main and preload in CJS, preload isolated and self-contained
 * (sandbox), renderer React + Tailwind with an injected CSP (without `https:`).
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

/** Production CSP (with the `recolt:` scheme; no remote http(s) origin). */
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

/** Dev: react-refresh preamble (`'unsafe-inline'`) and local HMR WebSocket. */
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
 * Placeholder images for mock mode (`api/mock.ts`, dev only): `recolt://mock/<root>/<n>.svg`
 * is translated by `lib/media-url.ts` into `/__mock/media/<root>/<n>.svg?w=&h=&c=` (same origin, CSP `'self'`).
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
      // Two entries: the main process and the media worker (utilityProcess, → out/main/media.worker.js).
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
      // Single entry: self-contained bundle with no shared chunk. `isolatedEntries: true` is
      // useless here and breaks the build outside a TTY (electron-vite 5.0.0 calls
      // `process.stdout.moveCursor` without checking `isTTY`). Re-enable if a 2nd entry appears.
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
      // minified code (electron-vite does not minify by default): less to parse at
      // startup and less V8 memory (source and bytecode) in the renderer.
      minify: true,
      rollupOptions: {
        input: {
          index: resolve(root, 'src/renderer/index.html'),
          offscreen: resolve(root, 'src/renderer/offscreen.html'),
        },
      },
    },
  },
})
