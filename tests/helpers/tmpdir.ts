/**
 * Dossiers temporaires de test sous `<dépôt>/.tmp/tests/` (gitignoré, un `userData` par worktree).
 * Nettoyage automatique à la sortie du processus ; `removeTmpDir` pour un nettoyage anticipé.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { TMP_ROOT } from './paths'

const created = new Set<string>()
let hooked = false

function installExitHook(): void {
  if (hooked) return
  hooked = true
  process.on('exit', () => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true })
  })
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
