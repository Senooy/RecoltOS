/**
 * Écriture atomique : `<fichier>.tmp`, `fsync`, `rename`, puis `fsync` du dossier.
 * Un crash laisse soit l'ancien fichier, soit le nouveau, jamais un fichier tronqué.
 */
import fs from 'node:fs'
import path from 'node:path'

export function writeFileAtomic(file: string, data: string): void {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${file}.tmp`
  const fd = fs.openSync(tmp, 'w', 0o600)
  try {
    fs.writeFileSync(fd, data, 'utf8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
  try {
    const dfd = fs.openSync(dir, 'r')
    try {
      fs.fsyncSync(dfd)
    } finally {
      fs.closeSync(dfd)
    }
  } catch {
    // fsync d'un dossier non supporté : le rename reste atomique.
  }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`)
}

/** Met de côté un fichier illisible (`<fichier>.bad-<ts>`) avant de le remplacer. */
export function quarantine(file: string, at: number = Date.now()): string | null {
  try {
    const target = `${file}.bad-${at}`
    fs.renameSync(file, target)
    return target
  } catch {
    return null
  }
}
