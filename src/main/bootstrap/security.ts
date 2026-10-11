/**
 * Sécurité des WebContents (ARCHI §2.4) : pas de nouvelle fenêtre, pas de navigation,
 * pas de <webview>, permissions refusées sauf plein écran vidéo et écriture presse-papiers.
 * Les liens externes passent par `system.openExternal` (http(s) seulement).
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

/** À appeler après `ready` (la session par défaut n'existe pas avant). */
export function installDefaultSessionPolicy(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)),
  )
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
  ses.on('will-download', (event) => event.preventDefault())
}
