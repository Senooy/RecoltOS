/**
 * File d'attente des fichiers ouverts avant que le domaine import-ux soit prêt
 * (`open-file` arrive parfois avant `ready` sur macOS). Consommé par `import-ux/init.ts`.
 */

import path from 'node:path'

type OpenFilesHandler = (paths: string[]) => void

const pending: string[] = []
let handler: OpenFilesHandler | null = null

export function queueOpenFiles(paths: string[]): void {
  const clean = paths.filter((p) => typeof p === 'string' && p.startsWith('/'))
  if (clean.length === 0) return
  if (handler) handler(clean)
  else pending.push(...clean)
}

/** Enregistre le consommateur et lui livre immédiatement les chemins en attente. */
export function onOpenFiles(h: OpenFilesHandler): () => void {
  handler = h
  if (pending.length > 0) h(pending.splice(0, pending.length))
  return () => {
    if (handler === h) handler = null
  }
}

export interface FilesFromArgvOptions {
  /** `app.getAppPath()` : le dossier de l'app, et tout ce qu'il contient, n'est jamais un fichier ouvert. */
  appPath?: string
}

/** Entrée de script (`electron <fichier.js>`, p. ex. Playwright) : jamais un fichier à importer. */
const SCRIPT_ENTRY_RE = /\.[cm]?js$/i

/**
 * Chemins de fichiers dans un argv de `second-instance` (on ignore les options, l'exécutable en
 * `argv[0]`, l'entrée du script en `argv[1]` et tout chemin situé dans le dossier de l'app).
 * vérifie encore l'existence et le type (fichier ou dossier) avant d'importer.
 */
export function filesFromArgv(argv: readonly string[], opts: FilesFromArgvOptions = {}): string[] {
  const appPath = opts.appPath ? path.resolve(opts.appPath) : null
  return argv.slice(1).filter((a, index) => {
    if (!a.startsWith('/') || a.startsWith('--')) return false
    if (index === 0 && SCRIPT_ENTRY_RE.test(a)) return false
    if (appPath && (a === appPath || a.startsWith(appPath + path.sep))) return false
    return true
  })
}
