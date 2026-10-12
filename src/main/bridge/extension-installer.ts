/**
 * Copies the bundled extension to a FIXED path: `<userData>/extension/<target>/`,
 * only if the bundled version differs from `.recoltos-version`. Swaps via three renames
 * (`rename(2)` onto a non-empty directory fails with `ENOTEMPTY`); resumed at the next launch if
 * `CUR` is missing and `OLD` exists. Without `electron`.
 */
import { existsSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

export const VERSION_FILE = '.recoltos-version'

export function readVersion(dir: string): string | null {
  try {
    return readFileSync(path.join(dir, VERSION_FILE), 'utf8').trim() || null
  } catch {
    return null
  }
}

/** Version of a built extension folder (`manifest.json > version`). */
export function manifestVersion(dir: string): string | null {
  try {
    const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as {
      version?: unknown
    }
    return typeof m.version === 'string' ? m.version : null
  } catch {
    return null
  }
}

/**
 * Installs `bundledDir` into `destDir`. Returns `installed` (copy made), `current` (already up
 * to date) or `missing` (nothing bundled: dev without `build:ext`).
 */
export async function installExtension(
  bundledDir: string,
  destDir: string,
): Promise<'installed' | 'current' | 'missing'> {
  const CUR = destDir
  const NEXT = `${destDir}.next`
  const OLD = `${destDir}.old`
  if (!existsSync(CUR) && existsSync(OLD)) await fs.rename(OLD, CUR)
  const version = manifestVersion(bundledDir)
  if (!version) return 'missing'
  // The version alone is not enough in dev (same version, modified code): we also compare the manifest.
  const stamp = `${version}+${readFileSync(path.join(bundledDir, 'manifest.json')).length}`
  if (readVersion(CUR) === stamp) return 'current'
  await fs.rm(NEXT, { recursive: true, force: true })
  await fs.mkdir(path.dirname(NEXT), { recursive: true })
  await fs.cp(bundledDir, NEXT, { recursive: true })
  await fs.writeFile(path.join(NEXT, VERSION_FILE), stamp)
  if (existsSync(CUR)) {
    await fs.rm(OLD, { recursive: true, force: true })
    await fs.rename(CUR, OLD)
  }
  await fs.rename(NEXT, CUR)
  await fs.rm(OLD, { recursive: true, force: true })
  return 'installed'
}
