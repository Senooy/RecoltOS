/**
 * Drop content: paths of files AND folders (`webUtils.getPathForFile`, the main process walks
 * the folders: ≤ 12 levels, ≤ 20,000 files, confirmation beyond 200), otherwise an http(s) URL
 * (`text/uri-list` / `text/plain`, dragged from a browser).
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

/** The drag comes from outside (files or link), not from a grid card. */
export function isExternalDrag(types: readonly string[]): boolean {
  return types.includes('Files') || types.includes('text/uri-list')
}
