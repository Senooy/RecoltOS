/**
 * Permission « Enregistrement de l'écran ». `getMediaAccessStatus('screen')` ne
 * distingue en pratique que `granted` / pas `granted` ; `desktopCapturer.getSources` provoque le
 * prompt système. Développement / tests : `RECOLTOS_SCREEN_ACCESS=granted|denied` force la valeur
 * (refusé dans l'app empaquetée).
 */
import { app, desktopCapturer, shell, systemPreferences } from 'electron'

export type ScreenAccess = 'granted' | 'denied'

export function getScreenAccess(env = process.env): { access: ScreenAccess; raw: string } {
  const forced = !app.isPackaged ? env.RECOLTOS_SCREEN_ACCESS : undefined
  if (forced === 'granted' || forced === 'denied')
    return { access: forced, raw: `forced:${forced}` }
  let raw = 'unknown'
  try {
    raw = systemPreferences.getMediaAccessStatus('screen')
  } catch {
    raw = 'unknown'
  }
  return { access: raw === 'granted' ? 'granted' : 'denied', raw }
}

/** Inscrit l'app dans le volet et déclenche le prompt système (une fois). */
export async function provokePrompt(env = process.env): Promise<void> {
  // Accès forcé (tests) : jamais de vrai prompt TCC.
  if (!app.isPackaged && env.RECOLTOS_SCREEN_ACCESS) return
  await desktopCapturer
    .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    .catch(() => undefined)
}

export const PERMISSION_PANE =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

export function openPermissionPane(): Promise<void> {
  return shell.openExternal(PERMISSION_PANE)
}

export function relaunchApp(): void {
  app.relaunch()
  app.exit(0)
}
