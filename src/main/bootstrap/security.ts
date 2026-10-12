/**
 * WebContents security: no new window, no navigation,
 * no <webview>, permissions denied except video fullscreen and clipboard write.
 * External links go through `system.openExternal` (http(s) only).
 */
import { app, session } from 'electron'

const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write'])

export function installSecurity(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

/** Call after `ready` (the default session does not exist before it). */
export function installDefaultSessionPolicy(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)),
  )
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
  ses.on('will-download', (event) => event.preventDefault())
}
