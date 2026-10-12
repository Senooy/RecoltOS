/**
 * `pnpm run shots [--scene a,b] [--library demo|real|none] [--theme light|dark|both] [--lang fr|en] [--out dir]`
 * launches the app like the e2e tests (automatic build, fresh `userData`) with
 * `--force-device-scale-factor=2` and writes `.visual/current/<scene>-<theme>.png` (2560×1640) plus
 * `manifest.json` (result of each scene: ok / unavailable + reason).
 *
 * `--library demo` (default): demo library from `make-fixtures.mts`; `--library real`: copy of a
 * RecoltOS `userData` folder, from `RECOLTOS_REAL_USERDATA` (a COPY, never the live folder under
 * `~/Library/Application Support`);
 * `--library none`: empty app. `--lang en`: English interface (`ui.language` setting); by default
 * French, like the visual baselines.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { launchApp } from '../../tests/helpers/electron-app'
import { ensureBuild } from '../../tests/helpers/ensure-build'
import { makeTmpDir, removeTmpDir } from '../../tests/helpers/tmpdir'
import { cloneDir, makeDemoLibrary } from '../../tests/helpers/demo-library'
import { mergeManifest, ROOT } from './manifest.mjs'
import { ALL_SCENES, freezePage, playScene, selectScenes } from './scenes.mjs'

export interface ShotResult {
  scene: string
  theme: string
  file: string | null
  status: 'ok' | 'unavailable' | 'error'
  reason?: string
}

export const LIBRARY_MODES = ['demo', 'real', 'none'] as const
export const THEME_MODES = ['light', 'dark', 'both'] as const
export const LANG_MODES = ['fr', 'en'] as const

/** Usage message (in French) if `--library` is not `demo`, `real` or `none`; otherwise `null`. */
export function libraryUsageError(value: string): string | null {
  return (LIBRARY_MODES as readonly string[]).includes(value)
    ? null
    : `unknown --library "${value}" (values: ${LIBRARY_MODES.join(', ')})`
}

/** Usage message (in French) if `--theme` is not `light`, `dark` or `both`; otherwise `null`. */
export function themeUsageError(value: string): string | null {
  return (THEME_MODES as readonly string[]).includes(value)
    ? null
    : `unknown --theme "${value}" (values: ${THEME_MODES.join(', ')})`
}

/**
 * Refusal of a `RECOLTOS_REAL_USERDATA` source that points to a live data folder (under
 * `Library/Application Support`): we work on a copy. Resolved AND real path (symbolic links).
 * `null` = source accepted.
 */
export function realSourceRefusal(src: string): string | null {
  const resolved = resolve(src)
  let real = resolved
  try {
    real = realpathSync(resolved)
  } catch {
    // Source missing: the copy will fail later with an explicit message.
  }
  for (const candidate of [resolved, real]) {
    if (/\/library\/application support(\/|$)/i.test(candidate))
      return `RECOLTOS_REAL_USERDATA refused: ${src} is a live data folder (use a copy)`
  }
  return null
}

async function prepareUserData(
  library: string,
  theme: string,
  empty: boolean,
  lang = 'fr',
): Promise<string> {
  const dir = makeTmpDir(`shots-${theme}`)
  if (!empty && library === 'demo') await makeDemoLibrary(dir, { count: 60, collections: 6 })
  else if (!empty && library === 'real') {
    const src = process.env.RECOLTOS_REAL_USERDATA as string
    cloneDir(resolve(src), dir)
  }
  const ui = lang === 'en' ? { ui: { language: 'en' } } : {}
  writeFileSync(join(dir, 'prefs.json'), JSON.stringify({ version: 1, theme, ...ui }) + '\n')
  return dir
}

const USAGE =
  'usage: shots.mts [--scene a,b] [--library demo|real|none] [--theme light|dark|both] [--lang fr|en] [--out dir] [--list]'

function parseShotOptions(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    options: {
      scene: { type: 'string' },
      library: { type: 'string', default: 'demo' },
      theme: { type: 'string', default: 'light' },
      lang: { type: 'string', default: 'fr' },
      out: { type: 'string' },
      list: { type: 'boolean', default: false },
    },
  })
}

async function main(argv: readonly string[]): Promise<number> {
  let values: ReturnType<typeof parseShotOptions>['values']
  try {
    ;({ values } = parseShotOptions(argv))
  } catch (e) {
    console.error(`shots: ${(e as Error).message}`)
    console.error(USAGE)
    return 2
  }
  if (values.list) {
    for (const s of ALL_SCENES) console.log(`${s.id.padEnd(20)} ${s.title}`)
    return 0
  }
  const library = values.library ?? 'demo'
  const libraryError = libraryUsageError(library)
  const themeError = themeUsageError(values.theme ?? 'light')
  const realError =
    library === 'real' && !process.env.RECOLTOS_REAL_USERDATA
      ? '--library real requires RECOLTOS_REAL_USERDATA (a copy of a RecoltOS userData folder)'
      : library === 'real'
        ? realSourceRefusal(process.env.RECOLTOS_REAL_USERDATA as string)
        : null
  const langError = (LANG_MODES as readonly string[]).includes(values.lang ?? 'fr')
    ? null
    : `unknown --lang "${values.lang}" (values: ${LANG_MODES.join(', ')})`
  const usageError = libraryError ?? themeError ?? realError ?? langError
  if (usageError) {
    console.error(`shots: ${usageError}`)
    console.error(USAGE)
    return 2
  }
  const themes = values.theme === 'both' ? ['light', 'dark'] : [values.theme ?? 'light']
  const scenes = selectScenes(values.scene?.split(',').map((s) => s.trim()))
  const out = resolve(values.out ?? join(ROOT, '.visual/current'))
  mkdirSync(out, { recursive: true })

  if (ensureBuild(ROOT)) console.log('shots: out/ rebuilt')
  const results: ShotResult[] = []
  for (const theme of themes) {
    for (const scene of scenes) {
      const userData = await prepareUserData(
        values.library ?? 'demo',
        theme,
        scene.empty === true,
        values.lang ?? 'fr',
      )
      const handle = await launchApp({ userData, deviceScaleFactor: 2, windowSize: '1280x820' })
      const file = join(out, `${scene.id}-${theme}.png`)
      try {
        await handle.page.waitForSelector('#root > *', { state: 'visible' })
        const played = await playScene(scene, handle.page, handle.app)
        if (!played.ok) {
          rmSync(file, { force: true })
          results.push({
            scene: scene.id,
            theme,
            file: null,
            status: 'unavailable',
            reason: played.reason,
          })
          console.log(`· ${scene.id}-${theme}: unavailable (${played.reason})`)
        } else {
          await freezePage(handle.page)
          await handle.page.screenshot({ path: file, animations: 'disabled', caret: 'hide' })
          results.push({ scene: scene.id, theme, file, status: 'ok' })
          console.log(`✔ ${scene.id}-${theme} → ${file}`)
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        results.push({ scene: scene.id, theme, file: null, status: 'error', reason })
        console.error(`✘ ${scene.id}-${theme}: ${reason}`)
      } finally {
        await handle.close()
        removeTmpDir(userData)
      }
    }
  }
  // Merge with the previous manifest: `shots --scene a` must not remove the others.
  const manifestFile = join(out, 'manifest.json')
  const previous: ShotResult[] = existsSync(manifestFile)
    ? (JSON.parse(readFileSync(manifestFile, 'utf8')) as ShotResult[])
    : []
  writeFileSync(manifestFile, JSON.stringify(mergeManifest(previous, results), null, 2) + '\n')
  const ok = results.filter((r) => r.status === 'ok').length
  console.log(`\nshots: ${ok}/${results.length} scene(s) captured in ${out}`)
  return results.some((r) => r.status === 'error') ? 1 : 0
}

// Entry guard: importing this module (tests) does not start the capture.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (err) {
    console.error(`shots: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}
