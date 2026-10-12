/**
 * Lancement de l'app Electron pour les projets Playwright e2e / visual / perf.
 * Lance `out/main/index.js` (build non empaqueté) avec les variables de testabilité :
 * `RECOLTOS_USER_DATA` (un dossier neuf sous `.tmp/`), `RECOLTOS_E2E=1`, `RECOLTOS_HOME`,
 * `RECOLTOS_WINDOW=1280x820`, `TZ=Europe/Paris`, `LANG=fr_FR.UTF-8`. Collecte `console.error` et
 * `pageerror` (y compris les violations CSP, converties en erreurs par le navigateur).
 *
 * Capture déterministe : les écouteurs `console` / `pageerror` sont posés APRÈS `electron.launch()`,
 * donc les erreurs émises pendant le chargement initial leur échappent (course mesurée : 1 lancement
 * sur 3 seulement les voyait). Playwright retient pourtant les derniers messages et erreurs de
 * chaque page depuis sa création : `flushErrors()` les relit (`page.consoleMessages()`,
 * `page.pageErrors()`) et les fusionne avec `errors` (sans doublon). À appeler avant toute
 * assertion « 0 erreur » et avant la fermeture ; la fixture `e2e-fixtures.ts` le fait.
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './paths'
import { makeTmpDir } from './tmpdir'

export interface LaunchOptions {
  /** `userData` imposé (sinon dossier neuf supprimé à la fermeture). */
  userData?: string
  /** `RECOLTOS_HOME` imposé (sinon un sous-dossier de `userData`). */
  home?: string
  /** Taille de fenêtre `LxH` (défaut 1280x820). */
  windowSize?: string
  /** Densité de pixels : 1 pour les tests (défaut), 2 pour `pnpm run shots`. */
  deviceScaleFactor?: 1 | 2
  /** Variables d'environnement supplémentaires. */
  env?: Record<string, string>
  /** Arguments Electron supplémentaires (après ceux du lanceur). */
  args?: string[]
  /** Motifs de messages `console.error` tolérés (à justifier dans le test). */
  allowErrors?: RegExp[]
  /** Racine du dépôt à lancer (défaut : celle des tests). */
  root?: string
}

export interface AppHandle {
  app: ElectronApplication
  page: Page
  userData: string
  home: string
  /** Erreurs console / pageerror reçues jusqu'ici (écouteurs en direct), hors motifs tolérés. */
  errors: string[]
  /**
   * Fusionne dans `errors` les erreurs retenues par Playwright pour toutes les fenêtres ouvertes
   * (y compris celles émises avant la pose des écouteurs) et renvoie la liste complète, sans doublon.
   */
  flushErrors: () => Promise<string[]>
  close: () => Promise<void>
}

/**
 * Variables héritées du shell qui changent le comportement d'Electron au lancement. Elles doivent être
 * ABSENTES (pas vides) de l'environnement passé à `electron.launch` : `ELECTRON_RUN_AS_NODE` est testée
 * par présence, et son héritage (terminaux, IDE) fait échouer `_electron.launch` de façon opaque.
 */
export const INHERITED_ELECTRON_ENV_TO_DROP: readonly string[] = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'NODE_OPTIONS',
  'ELECTRON_RENDERER_URL',
]

/**
 * Environnement de l'app lancée : celui du processus de test, sans les variables ci-dessus, puis les
 * réglages de testabilité et enfin `extra` (choix explicite de l'appelant, en dernier).
 */
export function buildLaunchEnv(
  processEnv: NodeJS.ProcessEnv,
  testability: Record<string, string>,
  extra: Record<string, string> = {},
): Record<string, string> {
  const base: Record<string, string> = {}
  for (const [key, value] of Object.entries(processEnv)) {
    if (value === undefined || INHERITED_ELECTRON_ENV_TO_DROP.includes(key)) continue
    base[key] = value
  }
  return { ...base, ...testability, ...extra }
}

export function electronExecutable(root: string = REPO_ROOT): string {
  return createRequire(join(root, 'package.json'))('electron') as string
}

export async function launchApp(options: LaunchOptions = {}): Promise<AppHandle> {
  const root = options.root ?? REPO_ROOT
  const ownsUserData = !options.userData
  // `home` est créé à côté de `userData` quand il n'est pas imposé : il est alors supprimé avec lui,
  // y compris quand `userData` est fourni par l'appelant (sinon il restait sur disque).
  const ownsHome = !options.home
  const userData = options.userData ?? makeTmpDir('userdata')
  const home = options.home ?? join(userData, '..', `${userData.split('/').pop() ?? 'ud'}-home`)
  mkdirSync(userData, { recursive: true })
  mkdirSync(home, { recursive: true })
  const dsf = options.deviceScaleFactor ?? 1
  const cleanupDirs = (): void => {
    if (ownsUserData) rmSync(userData, { recursive: true, force: true })
    if (ownsHome) rmSync(home, { recursive: true, force: true })
  }

  let app: ElectronApplication
  try {
    app = await electron.launch({
      executablePath: electronExecutable(root),
      cwd: root,
      args: [
        '.',
        `--force-device-scale-factor=${dsf}`,
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        ...(options.args ?? []),
      ],
      // `ELECTRON_RENDERER_URL` et les variables de `INHERITED_ELECTRON_ENV_TO_DROP` ne sont jamais
      // transmises : l'app lancée n'hérite pas de l'environnement du shell ni d'un autre test.
      env: buildLaunchEnv(
        process.env,
        {
          RECOLTOS_USER_DATA: userData,
          RECOLTOS_E2E: '1',
          RECOLTOS_HOME: home,
          RECOLTOS_WINDOW: options.windowSize ?? '1280x820',
          TZ: 'Europe/Paris',
          LANG: 'fr_FR.UTF-8',
          // Langue du système simulée : français, comme les baselines visuelles et les assertions
          // e2e. Un test en anglais passe `env: { RECOLTOS_LANG: 'en' }` ou le réglage `ui.language`.
          RECOLTOS_LANG: 'fr',
        },
        options.env,
      ),
    })
  } catch (err) {
    cleanupDirs()
    throw err
  }

  const errors: string[] = []
  const allow = options.allowErrors ?? []
  const record = (text: string): void => {
    if (!allow.some((re) => re.test(text)) && !errors.includes(text)) errors.push(text)
  }
  const consoleLine = (text: string): string => `console.error : ${text}`
  const pageErrorLine = (message: string): string => `pageerror : ${message}`
  const watch = (page: Page): void => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') record(consoleLine(msg.text()))
    })
    page.on('pageerror', (err) => record(pageErrorLine(err.message)))
  }
  const flushErrors = async (): Promise<string[]> => {
    for (const w of app.windows()) {
      if (w.isClosed()) continue
      // Les erreurs de chargement (CSP, script inline) sont émises avant `load` : on l'attend, sinon
      // un appel trop précoce lirait une liste encore vide.
      await w.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined)
      for (const msg of await w.consoleMessages().catch(() => [])) {
        if (msg.type() === 'error') record(consoleLine(msg.text()))
      }
      for (const err of await w.pageErrors().catch(() => [])) record(pageErrorLine(err.message))
    }
    return errors
  }
  const close = async (): Promise<void> => {
    await app.close().catch(() => undefined)
    cleanupDirs()
  }

  // Si `firstWindow()` échoue (délai dépassé), l'application lancée est fermée et les dossiers
  // nettoyés avant de relancer l'erreur : sinon un processus Electron reste en vie.
  let page: Page
  try {
    app.on('window', watch)
    page = await app.firstWindow()
    watch(page)
  } catch (err) {
    await close()
    throw err
  }

  return {
    app,
    page,
    userData,
    home,
    errors,
    flushErrors,
    close,
  }
}
