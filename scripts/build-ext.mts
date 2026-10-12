/**
 * Extension MV3 : `extension/` → `dist-extension/<cible>/` pour chaque cible
 * (`chromium`, `firefox`), une seule base de code.
 *  - manifest généré par `extension/manifest.ts` (`buildManifest(cible)`), version = `EXTENSION_VERSION` ;
 *  - script d'arrière-plan : `extension/src/background/index.ts` → `background.js` (IIFE autonome :
 *    service worker classique côté Chromium, `background.scripts` côté Firefox) ;
 *  - scripts de contenu : chaque `extension/src/content/*.ts` → `content/<nom>.js` (IIFE, aucun `import`) ;
 *  - popup : `extension/src/popup/index.ts` → `popup.js`, `popup.html` et `popup.css` copiés ;
 *  - icônes 16/32/48/128 générées depuis `build/icon.png` (sharp).
 * `--test-base http://127.0.0.1:<port>` : build de TEST (faux serveur, poignées Playwright) vers
 * `--out` (jamais `dist-extension/`). Sans `extension/manifest.ts`, sort proprement.
 */
import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')
export const EXT_TARGETS = ['chromium', 'firefox'] as const
export type ExtTarget = (typeof EXT_TARGETS)[number]

export interface BuildExtOptions {
  root?: string
  /** Dossier racine de sortie (défaut `dist-extension/`) ; chaque cible dans un sous-dossier. */
  outDir?: string
  targets?: readonly ExtTarget[]
  /** Build de test : toutes les plateformes remplacées par ce faux serveur local. */
  testBase?: string
  /** Build de test : auto-test au démarrage (cookies factices, requête X, rapport au faux serveur). */
  selfTest?: boolean
  logLevel?: 'info' | 'silent'
}

async function icons(root: string, out: string): Promise<void> {
  const src = join(root, 'build/icon.png')
  mkdirSync(join(out, 'icons'), { recursive: true })
  if (!existsSync(src)) return
  const sharp = (await import('sharp')).default
  for (const size of [16, 32, 48, 128]) {
    await sharp(src)
      .resize(size, size)
      .png()
      .toFile(join(out, 'icons', `${size}.png`))
  }
}

async function buildTarget(
  root: string,
  target: ExtTarget,
  out: string,
  opts: BuildExtOptions,
): Promise<void> {
  const src = join(root, 'extension')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  const common = {
    bundle: true,
    platform: 'browser' as const,
    format: 'iife' as const,
    target: ['chrome127', 'firefox128'],
    alias: { '@shared': join(root, 'src/shared') },
    legalComments: 'none' as const,
    // Constantes de `define` repliées et branches mortes retirées : le build livré ne contient ni
    // l'auto-test ni les points d'accès du faux serveur. Identifiants lisibles conservés.
    minifySyntax: true,
    treeShaking: true,
    logLevel: opts.logLevel ?? ('info' as const),
    define: {
      __RECOLTOS_TARGET__: JSON.stringify(target),
      __RECOLTOS_TEST_BASE__: JSON.stringify(opts.testBase ?? ''),
      __RECOLTOS_SELFTEST__: JSON.stringify(Boolean(opts.testBase && opts.selfTest)),
    },
  }
  const background = join(src, 'src/background/index.ts')
  if (existsSync(background)) {
    await build({ ...common, entryPoints: [background], outfile: join(out, 'background.js') })
  }
  const contentDir = join(src, 'src/content')
  if (existsSync(contentDir)) {
    for (const f of readdirSync(contentDir).filter(
      (n) => n.endsWith('.ts') && !n.endsWith('.d.ts') && !n.endsWith('.test.ts'),
    )) {
      await build({
        ...common,
        entryPoints: [join(contentDir, f)],
        outfile: join(out, 'content', f.replace(/\.ts$/, '.js')),
      })
    }
  }
  const popupDir = join(src, 'src/popup')
  if (existsSync(join(popupDir, 'index.ts'))) {
    await build({
      ...common,
      entryPoints: [join(popupDir, 'index.ts')],
      outfile: join(out, 'popup.js'),
    })
    for (const f of readdirSync(popupDir).filter(
      (n) => n.endsWith('.html') || n.endsWith('.css'),
    )) {
      cpSync(join(popupDir, f), join(out, f))
    }
  }
  if (existsSync(join(src, 'icons')))
    cpSync(join(src, 'icons'), join(out, 'icons'), { recursive: true })
  else await icons(root, out)
  const { buildManifest } = (await import(pathToFileURL(join(src, 'manifest.ts')).href)) as {
    buildManifest: (t: ExtTarget, o: { extraHosts?: string[] }) => Record<string, unknown>
  }
  const manifest = buildManifest(
    target,
    opts.testBase ? { extraHosts: [`${opts.testBase}/*`] } : {},
  )
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

export async function buildExt(options: BuildExtOptions = {}): Promise<string | null> {
  const root = options.root ?? ROOT
  if (!existsSync(join(root, 'extension/manifest.ts'))) return null
  const out = options.outDir ?? join(root, 'dist-extension')
  if (options.testBase && !options.outDir) {
    throw new Error('build de test : --out obligatoire (jamais dist-extension/)')
  }
  for (const t of options.targets ?? EXT_TARGETS) {
    await buildTarget(root, t, join(out, t), options)
  }
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      'test-base': { type: 'string' },
      out: { type: 'string' },
      target: { type: 'string', multiple: true },
      selftest: { type: 'boolean', default: false },
    },
  })
  buildExt({
    ...(values['test-base'] ? { testBase: values['test-base'] } : {}),
    ...(values.out ? { outDir: resolve(values.out) } : {}),
    ...(values.target ? { targets: values.target as ExtTarget[] } : {}),
    selfTest: values.selftest,
  })
    .then((out) => {
      console.log(
        out ? `build:ext : ${out}` : 'build:ext : extension/manifest.ts absent, rien à construire',
      )
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err)
      process.exitCode = 1
    })
}
