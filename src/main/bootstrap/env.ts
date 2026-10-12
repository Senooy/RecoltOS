/**
 * Drapeaux d'exécution lus une fois au démarrage (contrats de testabilité).
 * Sans import `electron` : testable sous Node.
 */
import { langFromLocale, type Lang } from '../../shared/i18n/lang'

export interface RuntimeFlags {
  /** `RECOLTOS_E2E=1` : ni raccourci global, ni sync, ni IA, ni manifests, ni réseau ; animations coupées. */
  e2e: boolean
  /** Taille imposée (`RECOLTOS_WINDOW=1280x820`), sinon `null`. */
  windowSize: { width: number; height: number } | null
  /** `RECOLTOS_HOME` remplace `os.homedir()` (manifests, dossier de dépôt). */
  home: string | null
  /** URL du serveur Vite en dev (`ELECTRON_RENDERER_URL`, posée par electron-vite). */
  rendererUrl: string | null
  /** `RECOLTOS_INSTALL_DEV_HOST=1` : manifests de dev (`com.recoltos.host.dev`). */
  installDevHost: boolean
  /**
   * `RECOLTOS_LANG=fr|en` : langue du système SIMULÉE (tests e2e et visuels, captures). Le réglage
   * `ui.language` garde la priorité ; `null` = langue préférée du Mac.
   */
  systemLang: Lang | null
}

export const DEFAULT_WINDOW = { width: 1280, height: 820 } as const
export const MIN_WINDOW = { width: 1040, height: 620 } as const

export function parseWindowSize(raw: string | undefined): { width: number; height: number } | null {
  if (!raw) return null
  const m = /^\s*(\d{3,5})\s*[x×]\s*(\d{3,5})\s*$/i.exec(raw)
  if (!m?.[1] || !m[2]) return null
  const width = Math.max(MIN_WINDOW.width, Number(m[1]))
  const height = Math.max(MIN_WINDOW.height, Number(m[2]))
  return { width, height }
}

export function readFlags(env: Record<string, string | undefined> = process.env): RuntimeFlags {
  const e2e = env.RECOLTOS_E2E === '1'
  return {
    e2e,
    windowSize: parseWindowSize(env.RECOLTOS_WINDOW) ?? (e2e ? { ...DEFAULT_WINDOW } : null),
    home: env.RECOLTOS_HOME ? env.RECOLTOS_HOME : null,
    rendererUrl: env.ELECTRON_RENDERER_URL ? env.ELECTRON_RENDERER_URL : null,
    installDevHost: env.RECOLTOS_INSTALL_DEV_HOST === '1',
    systemLang: env.RECOLTOS_LANG ? langFromLocale(env.RECOLTOS_LANG) : null,
  }
}
