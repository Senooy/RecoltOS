/**
 * Atomic write: `<fichier>.tmp`, `fsync`, `rename`, then `fsync` of the folder.
 * A crash leaves either the old file or the new one, never a truncated file.
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
    // fsync on an unsupported folder: the rename stays atomic.
  }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`)
}

/** Sets aside an unreadable file (`<fichier>.bad-<ts>`) before replacing it. */
export function quarantine(file: string, at: number = Date.now()): string | null {
  try {
    const target = `${file}.bad-${at}`
    fs.renameSync(file, target)
    return target
  } catch {
    return null
  }
}
