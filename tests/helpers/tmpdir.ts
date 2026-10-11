/**
 * Dossiers temporaires de test sous `<dépôt>/.tmp/tests/` (gitignoré, un `userData` par worktree).
 * Nettoyage : `removeAllTmpDirs()` est appelé par `tests/setup/node.ts` (`afterAll` de chaque fichier
 * vitest — `process.on('exit')` ne s'exécute pas dans les workers `forks` de vitest) ; le hook
 * `exit` reste pour Playwright et les scripts. `purgeStaleTmpDirs()` (globalSetup) supprime ce
 * que des exécutions tuées ont laissé. `removeTmpDir` pour un nettoyage anticipé.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { TMP_ROOT } from './paths'

const created = new Set<string>()
let hooked = false

function installExitHook(): void {
  if (hooked) return
  hooked = true
  process.on('exit', removeAllTmpDirs)
}

/** Crée un dossier vide et unique ; `label` ne sert qu'au débogage (`.tmp/tests/<label>-XXXXXX`). */
export function makeTmpDir(label = 'test'): string {
  const base = join(TMP_ROOT, 'tests')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, `${label.replace(/[^\w.-]+/g, '_')}-`))
  created.add(dir)
  installExitHook()
  return dir
}

/** Supprime tous les dossiers créés par ce processus (hook `afterAll` des tests vitest). */
export function removeAllTmpDirs(): void {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
  created.clear()
}

/**
 * Supprime de `.tmp/tests/` les dossiers plus vieux que `maxAgeMs` (10 min par défaut) : restes
 * d'exécutions interrompues. Le seuil évite d'effacer les dossiers d'un autre processus en cours
 * (Playwright lancé en parallèle dans le même worktree).
 */
export function purgeStaleTmpDirs(maxAgeMs = 10 * 60_000): number {
  const base = join(TMP_ROOT, 'tests')
  if (!existsSync(base)) return 0
  let removed = 0
  for (const name of readdirSync(base)) {
    const dir = join(base, name)
    try {
      if (Date.now() - statSync(dir).mtimeMs < maxAgeMs) continue
      rmSync(dir, { recursive: true, force: true })
      removed += 1
    } catch {
      /* dossier disparu entre-temps ou illisible : on ignore */
    }
  }
  return removed
}

export function removeTmpDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
  created.delete(dir)
}

/** Exécute `fn` dans un dossier temporaire, supprimé ensuite (même en cas d'échec). */
export async function withTmpDir<T>(
  fn: (dir: string) => Promise<T> | T,
  label = 'test',
): Promise<T> {
  const dir = makeTmpDir(label)
  try {
    return await fn(dir)
  } finally {
    removeTmpDir(dir)
  }
}
