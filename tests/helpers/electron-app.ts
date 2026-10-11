/**
 * Lancement de l'app Electron pour les projets Playwright e2e / visual / perf (QA §6.1, §7.2).
 * Lance `out/main/index.js` (build non empaqueté) avec les variables de testabilité (QA §2) :
 * `RECOLTOS_USER_DATA` (un dossier neuf sous `.tmp/`), `RECOLTOS_E2E=1`, `RECOLTOS_HOME`,
 * `RECOLTOS_WINDOW=1280x820`, `TZ=Europe/Paris`, `LANG=fr_FR.UTF-8`. Collecte `console.error` et
 * `pageerror` (y compris les violations CSP, converties en erreurs par le navigateur).
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
  /** Densité de pixels : 1 pour les tests (défaut), 2 pour `pnpm run shots` (QA §7.2). */
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
  /** Erreurs console / pageerror reçues jusqu'ici, hors motifs tolérés. */
  errors: string[]
  close: () => Promise<void>
}

export function electronExecutable(root: string = REPO_ROOT): string {
  return createRequire(join(root, 'package.json'))('electron') as string
}

export async function launchApp(options: LaunchOptions = {}): Promise<AppHandle> {
  const root = options.root ?? REPO_ROOT
  const ownsUserData = !options.userData
  const userData = options.userData ?? makeTmpDir('userdata')
  const home = options.home ?? join(userData, '..', `${userData.split('/').pop() ?? 'ud'}-home`)
  mkdirSync(userData, { recursive: true })
  mkdirSync(home, { recursive: true })
  const dsf = options.deviceScaleFactor ?? 1

  const app = await electron.launch({
    executablePath: electronExecutable(root),
    cwd: root,
    args: [
      '.',
      `--force-device-scale-factor=${dsf}`,
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      ...(options.args ?? []),
    ],
    env: {
      ...(process.env as Record<string, string>),
      RECOLTOS_USER_DATA: userData,
      RECOLTOS_E2E: '1',
      RECOLTOS_HOME: home,
      RECOLTOS_WINDOW: options.windowSize ?? '1280x820',
      TZ: 'Europe/Paris',
      LANG: 'fr_FR.UTF-8',
      // L'app lancée n'hérite jamais de l'environnement d'un autre lot.
      ELECTRON_RENDERER_URL: '',
      ...options.env,
    },
  })

  const errors: string[] = []
  const allow = options.allowErrors ?? []
  const record = (text: string): void => {
    if (!allow.some((re) => re.test(text))) errors.push(text)
  }
  const watch = (page: Page): void => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') record(`console.error : ${msg.text()}`)
    })
    page.on('pageerror', (err) => record(`pageerror : ${err.message}`))
  }
  app.on('window', watch)
  const page = await app.firstWindow()
  watch(page)

  return {
    app,
    page,
    userData,
    home,
    errors,
    close: async () => {
      await app.close().catch(() => undefined)
      if (ownsUserData) {
        rmSync(userData, { recursive: true, force: true })
        rmSync(home, { recursive: true, force: true })
      }
    },
  }
}
