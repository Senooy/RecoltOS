/**
 * Fenêtres hors écran : capture de page, rendu de carte post, stage Spaces.
 * Partition non persistante `recolt-offscreen-<n>`, sandbox, SANS preload (jamais
 * `window.recolt`), permissions refusées, navigation initiée par la page et téléchargements
 * bloqués, délai de 20 s, destruction après usage.
 *
 * Redirections : un `preventDefault` sur `will-redirect` annule TOUTE la navigation
 * (`loadURL` rejeté avec `ERR_FAILED`) ; on n'accepte donc que les redirections http(s) → http(s),
 * dans la limite de `MAX_REDIRECTS` sauts (http→https, liens courts, slash final).
 *
 * Sessions : Electron ne libère jamais une `Session`. Les partitions sont donc recyclées via un
 * petit parc (`partitionPool`) : une partition est prise pour la durée d'un appel, vidée
 * (`clearStorageData` + `clearCache`) puis rendue. Le nombre de sessions créées est borné par la
 * concurrence maximale observée, pas par le nombre d'appels (rendu de centaines de cartes).
 */
import { BrowserWindow, session, type Session } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { AppError } from '../../shared/errors'

export const OFFSCREEN_TIMEOUT_MS = 20_000
export const MAX_REDIRECTS = 10

export interface OffscreenOptions {
  width: number
  height: number
  /** Rendu hors écran Chromium (`webPreferences.offscreen`). */
  offscreen?: boolean
  deviceScaleFactor?: number
  javascript?: boolean
  timeoutMs?: number
}

export type OffscreenRoute = 'tweet-card' | 'space-stage'

/** URL de `renderer/offscreen.html?render=<route>` (serveur Vite en dev, `file://` en prod). */
export function offscreenUrl(route: OffscreenRoute, params: Record<string, string> = {}): string {
  const q = new URLSearchParams({ render: route, ...params }).toString()
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) return `${dev.replace(/\/$/, '')}/offscreen.html?${q}`
  return `${pathToFileURL(path.join(__dirname, '../renderer/offscreen.html')).toString()}?${q}`
}

/** Redirection acceptée : http(s) → http(s) ; ni `file:`, ni `data:`, ni schéma applicatif. */
export function isAllowedRedirect(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

let partitionCounter = 0
/** Partitions inactives, prêtes à être réutilisées. */
const partitionPool: string[] = []

/**
 * Configuration additionnelle de chaque session hors écran. `protocol.handle` ne vaut que pour la
 * session sur laquelle il est appelé : sans ce point d'accroche, `recolt://` (avatars et médias de
 * la carte de post, vignettes du stage Spaces) échoue dans les partitions hors écran. y
 * enregistre `recolt:` (lecture seule, mêmes racines que la session par défaut).
 * La fonction est appelée sur chaque partition créée, et sur celles déjà créées à l'enregistrement.
 */
export type OffscreenSessionSetup = (ses: Session) => void
const sessionSetups: OffscreenSessionSetup[] = []
const createdSessions: Session[] = []

export function registerOffscreenSessionSetup(fn: OffscreenSessionSetup): void {
  sessionSetups.push(fn)
  for (const ses of createdSessions) fn(ses)
}

/** Tests uniquement. */
export function resetOffscreenForTests(): void {
  sessionSetups.length = 0
  createdSessions.length = 0
  partitionPool.length = 0
  partitionCounter = 0
}

/** Prend une partition du parc ou en crée une (exporté pour les tests). */
export function acquirePartition(): string {
  const reused = partitionPool.pop()
  if (reused) return reused
  const partition = `recolt-offscreen-${++partitionCounter}`
  const ses = session.fromPartition(partition, { cache: false })
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.on('will-download', (event) => event.preventDefault())
  createdSessions.push(ses)
  for (const fn of sessionSetups) fn(ses)
  return partition
}

async function releasePartition(partition: string): Promise<void> {
  const ses = session.fromPartition(partition, { cache: false })
  try {
    await Promise.race([
      Promise.all([ses.clearStorageData(), ses.clearCache()]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('clear')), 5_000)),
    ])
    partitionPool.push(partition)
  } catch {
    // Partition possiblement polluée : on ne la réutilise pas.
  }
}

/**
 * Ouvre une fenêtre hors écran, exécute `run`, puis la détruit (toujours).
 * Rejette avec `AppError('timeout')` au-delà de `timeoutMs`.
 */
export async function withOffscreenWindow<T>(
  opts: OffscreenOptions,
  run: (win: BrowserWindow) => Promise<T>,
): Promise<T> {
  const partition = acquirePartition()

  const win = new BrowserWindow({
    show: false,
    width: opts.width,
    height: opts.height,
    useContentSize: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      offscreen: opts.offscreen ?? true,
      javascript: opts.javascript ?? true,
      zoomFactor: 1,
    },
  })
  const wc = win.webContents
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  // `will-navigate` ne se déclenche que pour les navigations initiées par la page.
  wc.on('will-navigate', (event) => event.preventDefault())
  let redirects = 0
  wc.on('will-redirect', (event, url) => {
    redirects += 1
    if (redirects > MAX_REDIRECTS || !isAllowedRedirect(url)) event.preventDefault()
  })
  wc.on('will-attach-webview', (event) => event.preventDefault())

  let timer: NodeJS.Timeout | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AppError('timeout', 'fenêtre hors écran : délai dépassé')),
      opts.timeoutMs ?? OFFSCREEN_TIMEOUT_MS,
    )
  })
  try {
    return await Promise.race([run(win), timeout])
  } finally {
    if (timer) clearTimeout(timer)
    if (!win.isDestroyed()) win.destroy()
    await releasePartition(partition)
  }
}
