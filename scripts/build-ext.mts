/**
 * Extension MV3 (QA §4.4) : `extension/` → `dist-extension/`.
 *  - `extension/manifest.json` et `extension/icons/` copiés tels quels ;
 *  - service worker : `extension/src/background/index.ts` → `background.js` (ESM,
 *    `"background": { "service_worker": "background.js", "type": "module" }`) ;
 *  - content scripts : chaque `extension/src/content/*.ts` → `content/<nom>.js`, bundle IIFE AUTONOME
 *    (un content script MV3 ne peut pas être un module ES) ;
 *  - popup : `extension/src/popup/index.ts` → `popup.js` (IIFE) et `extension/src/popup/*.html` copiés.
 * Sans `extension/manifest.json` (avant WP-53), sort proprement. WP-53 adapte les entrées.
 */
import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')

export interface BuildExtOptions {
  root?: string
  outDir?: string
  logLevel?: 'info' | 'silent'
}

export async function buildExt(options: BuildExtOptions = {}): Promise<string | null> {
  const root = options.root ?? ROOT
  const src = join(root, 'extension')
  if (!existsSync(join(src, 'manifest.json'))) return null
  const out = options.outDir ?? join(root, 'dist-extension')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  const common = {
    bundle: true,
    platform: 'browser' as const,
    target: 'chrome120',
    alias: { '@shared': join(root, 'src/shared') },
    legalComments: 'none' as const,
    logLevel: options.logLevel ?? ('info' as const),
  }

  const background = join(src, 'src/background/index.ts')
  if (existsSync(background)) {
    await build({
      ...common,
      entryPoints: [background],
      outfile: join(out, 'background.js'),
      format: 'esm',
    })
  }
  const contentDir = join(src, 'src/content')
  if (existsSync(contentDir)) {
    for (const f of readdirSync(contentDir).filter(
      (n) => n.endsWith('.ts') && !n.endsWith('.d.ts'),
    )) {
      await build({
        ...common,
        entryPoints: [join(contentDir, f)],
        outfile: join(out, 'content', f.replace(/\.ts$/, '.js')),
        format: 'iife',
      })
    }
  }
  const popup = join(src, 'src/popup/index.ts')
  if (existsSync(popup)) {
    await build({ ...common, entryPoints: [popup], outfile: join(out, 'popup.js'), format: 'iife' })
    for (const f of readdirSync(join(src, 'src/popup')).filter((n) => n.endsWith('.html'))) {
      cpSync(join(src, 'src/popup', f), join(out, f))
    }
  }
  cpSync(join(src, 'manifest.json'), join(out, 'manifest.json'))
  if (existsSync(join(src, 'icons')))
    cpSync(join(src, 'icons'), join(out, 'icons'), { recursive: true })
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildExt()
    .then((out) => {
      console.log(
        out
          ? `build:ext : ${out}`
          : 'build:ext : extension/manifest.json absent (WP-53), rien à construire',
      )
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err)
      process.exitCode = 1
    })
}
