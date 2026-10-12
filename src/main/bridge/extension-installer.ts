/**
 * Copie de l'extension embarquée vers un chemin FIXE : `<userData>/extension/<cible>/`,
 * seulement si la version embarquée diffère de `.recoltos-version`. Échange en trois renommages
 * (`rename(2)` vers un dossier non vide échoue avec `ENOTEMPTY`) ; reprise au lancement suivant si
 * `CUR` manque et `OLD` existe. Sans `electron`.
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

/** Version d'un dossier d'extension buildé (`manifest.json > version`). */
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
 * Installe `bundledDir` dans `destDir`. Rend `installed` (copie faite), `current` (déjà à jour) ou
 * `missing` (rien d'embarqué : dev sans `build:ext`).
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
  // La version seule ne suffit pas en dev (même version, code modifié) : on compare aussi le manifest.
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
