/**
 * `pnpm run shots [--scene a,b] [--library demo|real|none] [--theme light|dark|both] [--out dir]`
 * (QA §7.2) : lance l'app comme les tests e2e (build automatique, `userData` neuf) en
 * `--force-device-scale-factor=2` et écrit `.visual/current/<scène>-<thème>.png` (2560×1640) plus
 * `manifest.json` (résultat de chaque scène : ok / indisponible + raison).
 *
 * `--library demo` (défaut) : bibliothèque de démo de `make-fixtures.mts` ; `--library real` : copie
 * de la vraie bibliothèque importée, depuis `RECOLTOS_REAL_USERDATA` (jamais le dossier la référence) ;
 * `--library none` : app vide.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { launchApp } from '../../tests/helpers/electron-app'
import { ensureBuild } from '../../tests/helpers/ensure-build'
import { makeTmpDir, removeTmpDir } from '../../tests/helpers/tmpdir'
import { cloneDir, makeDemoLibrary } from '../../tests/helpers/demo-library'
import { mergeManifest, ROOT } from './refs.mjs'
import { ALL_SCENES, freezePage, playScene, selectScenes } from './scenes.mjs'

export interface ShotResult {
  scene: string
  theme: string
  file: string | null
  status: 'ok' | 'indisponible' | 'erreur'
  reason?: string
}

export const LIBRARY_MODES = ['demo', 'real', 'none'] as const
export const THEME_MODES = ['light', 'dark', 'both'] as const

/** Message d'usage (français) si `--library` n'est pas `demo`, `real` ou `none` ; sinon `null`. */
export function libraryUsageError(value: string): string | null {
  return (LIBRARY_MODES as readonly string[]).includes(value)
    ? null
    : `--library « ${value} » inconnu (valeurs : ${LIBRARY_MODES.join(', ')})`
}

/** Message d'usage (français) si `--theme` n'est pas `light`, `dark` ou `both` ; sinon `null`. */
export function themeUsageError(value: string): string | null {
  return (THEME_MODES as readonly string[]).includes(value)
    ? null
    : `--theme « ${value} » inconnu (valeurs : ${THEME_MODES.join(', ')})`
}

/**
 * Refus d'une source `RECOLTOS_REAL_USERDATA` qui désigne la bibliothèque la référence (lecture seule,
 * PLAN §2.1) : on vérifie le chemin résolu ET réel (liens symboliques). `null` = source acceptée.
 */
export function realSourceRefusal(src: string): string | null {
  const resolved = resolve(src)
  let real = resolved
  try {
    real = realpathSync(resolved)
  } catch {
    // Source absente : la copie échouera plus tard avec un message explicite.
  }
  for (const candidate of [resolved, real]) {
    if (/legacy/i.test(candidate) || /application support\/legacy/i.test(candidate))
      return `RECOLTOS_REAL_USERDATA refusé : ${src} désigne un dossier la référence (lecture seule, PLAN §2.1)`
  }
  return null
}

async function prepareUserData(library: string, theme: string, empty: boolean): Promise<string> {
  const dir = makeTmpDir(`shots-${theme}`)
  if (!empty && library === 'demo') await makeDemoLibrary(dir, { count: 60, collections: 6 })
  else if (!empty && library === 'real') {
    const src = process.env.RECOLTOS_REAL_USERDATA as string
    cloneDir(resolve(src), dir)
  }
  writeFileSync(join(dir, 'prefs.json'), JSON.stringify({ version: 1, theme }) + '\n')
  return dir
}

const USAGE =
  'usage : shots.mts [--scene a,b] [--library demo|real|none] [--theme light|dark|both] [--out dir] [--list]'

function parseShotOptions(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    options: {
      scene: { type: 'string' },
      library: { type: 'string', default: 'demo' },
      theme: { type: 'string', default: 'light' },
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
    console.error(`shots : ${(e as Error).message}`)
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
      ? '--library real exige RECOLTOS_REAL_USERDATA (copie de dev de la bibliothèque importée)'
      : library === 'real'
        ? realSourceRefusal(process.env.RECOLTOS_REAL_USERDATA as string)
        : null
  const usageError = libraryError ?? themeError ?? realError
  if (usageError) {
    console.error(`shots : ${usageError}`)
    console.error(USAGE)
    return 2
  }
  const themes = values.theme === 'both' ? ['light', 'dark'] : [values.theme ?? 'light']
  const scenes = selectScenes(values.scene?.split(',').map((s) => s.trim()))
  const out = resolve(values.out ?? join(ROOT, '.visual/current'))
  mkdirSync(out, { recursive: true })

  if (ensureBuild(ROOT)) console.log('shots : out/ reconstruit')
  const results: ShotResult[] = []
  for (const theme of themes) {
    for (const scene of scenes) {
      const userData = await prepareUserData(values.library ?? 'demo', theme, scene.empty === true)
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
            status: 'indisponible',
            reason: played.reason,
          })
          console.log(`· ${scene.id}-${theme} : indisponible (${played.reason})`)
        } else {
          await freezePage(handle.page)
          await handle.page.screenshot({ path: file, animations: 'disabled', caret: 'hide' })
          results.push({ scene: scene.id, theme, file, status: 'ok' })
          console.log(`✔ ${scene.id}-${theme} → ${file}`)
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        results.push({ scene: scene.id, theme, file: null, status: 'erreur', reason })
        console.error(`✘ ${scene.id}-${theme} : ${reason}`)
      } finally {
        await handle.close()
        removeTmpDir(userData)
      }
    }
  }
  // Fusion avec le manifeste précédent : `shots --scene a` ne doit pas faire disparaître les autres.
  const manifestFile = join(out, 'manifest.json')
  const previous: ShotResult[] = existsSync(manifestFile)
    ? (JSON.parse(readFileSync(manifestFile, 'utf8')) as ShotResult[])
    : []
  writeFileSync(manifestFile, JSON.stringify(mergeManifest(previous, results), null, 2) + '\n')
  const ok = results.filter((r) => r.status === 'ok').length
  console.log(`\nshots : ${ok}/${results.length} scène(s) capturée(s) dans ${out}`)
  return results.some((r) => r.status === 'erreur') ? 1 : 0
}

// Garde d'entrée : importer ce module (tests) ne lance pas la capture.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (err) {
    console.error(`shots : ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}
