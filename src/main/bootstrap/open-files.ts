/**
 * File d'attente des fichiers ouverts avant que le domaine import-ux soit prêt
 * (`open-file` arrive parfois avant `ready` sur macOS). Consommé par `import-ux/init.ts` (WP-34).
 */

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

/** Chemins de fichiers dans un argv de `second-instance` (on ignore les options et l'exécutable). */
export function filesFromArgv(argv: readonly string[]): string[] {
  return argv.slice(1).filter((a) => a.startsWith('/') && !a.startsWith('--'))
}
