/**
 * Contenu d'un dépôt (SPACES §3.1) : chemins des fichiers ET dossiers (`webUtils.getPathForFile`,
 * le main parcourt les dossiers : ≤ 12 niveaux, ≤ 20 000 fichiers, confirmation au-delà de 200),
 * sinon une URL http(s) (`text/uri-list` / `text/plain`, glisser depuis un navigateur).
 */

export interface DropContent {
  paths: string[]
  url: string | null
}

export function readDrop(dt: DataTransfer | null, pathForFile: (f: File) => string): DropContent {
  if (!dt) return { paths: [], url: null }
  const paths = Array.from(dt.files)
    .map((f) => {
      try {
        return pathForFile(f)
      } catch {
        return ''
      }
    })
    .filter((p) => p.startsWith('/'))
  if (paths.length > 0) return { paths: [...new Set(paths)], url: null }
  const raw = (dt.getData('text/uri-list') || dt.getData('text/plain') || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith('#'))
  return { paths: [], url: raw && /^https?:\/\//i.test(raw) ? raw : null }
}

/** Le glisser vient de l'extérieur (fichiers ou lien), pas d'une carte de la grille. */
export function isExternalDrag(types: readonly string[]): boolean {
  return types.includes('Files') || types.includes('text/uri-list')
}
