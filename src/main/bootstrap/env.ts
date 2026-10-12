/**
 * Runtime flags read once at startup (testability contracts).
 * No `electron` import: testable under Node.
 */
import { langFromLocale, type Lang } from '../../shared/i18n/lang'

export interface RuntimeFlags {
  /** `RECOLTOS_E2E=1`: no global shortcut, no sync, no AI, no manifests, no network; animations off. */
  e2e: boolean
  /** Forced size (`RECOLTOS_WINDOW=1280x820`), otherwise `null`. */
  windowSize: { width: number; height: number } | null
  /** `RECOLTOS_HOME` replaces `os.homedir()` (manifests, repository folder). */
  home: string | null
  /** Vite dev server URL (`ELECTRON_RENDERER_URL`, set by electron-vite). */
  rendererUrl: string | null
  /** `RECOLTOS_INSTALL_DEV_HOST=1`: dev manifests (`com.recoltos.host.dev`). */
  installDevHost: boolean
  /**
   * `RECOLTOS_LANG=fr|en`: SIMULATED system language (e2e and visual tests, screenshots). The
   * `ui.language` setting keeps priority; `null` = the Mac's preferred language.
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
