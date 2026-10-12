/**
 * Queue of files opened before the import-ux domain is ready
 * (`open-file` sometimes arrives before `ready` on macOS). Consumed by `import-ux/init.ts`.
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

/** Registers the consumer and immediately delivers the pending paths to it. */
export function onOpenFiles(h: OpenFilesHandler): () => void {
  handler = h
  if (pending.length > 0) h(pending.splice(0, pending.length))
  return () => {
    if (handler === h) handler = null
  }
}

export interface FilesFromArgvOptions {
  /** `app.getAppPath()`: the app folder, and everything in it, is never an opened file. */
  appPath?: string
}

/** Script entry (`electron <file.js>`, e.g. Playwright): never a file to import. */
const SCRIPT_ENTRY_RE = /\.[cm]?js$/i

/**
 * File paths in a `second-instance` argv (options are ignored, the executable is in
 * `argv[0]`, the script entry is in `argv[1]`, and any path inside the app folder is skipped).
 * Still checks existence and type (file or folder) before importing.
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
