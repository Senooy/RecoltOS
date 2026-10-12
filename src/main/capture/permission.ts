/**
 * "Screen Recording" permission. In practice `getMediaAccessStatus('screen')` only
 * distinguishes `granted` / not `granted`; `desktopCapturer.getSources` triggers the
 * system prompt. Development / tests: `RECOLTOS_SCREEN_ACCESS=granted|denied` forces the value
 * (refused in the packaged app).
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

/** Registers the app in the settings pane and triggers the system prompt (once). */
export async function provokePrompt(env = process.env): Promise<void> {
  // Forced access (tests): never a real TCC prompt.
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
