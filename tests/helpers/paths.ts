/**
 * Chemins du dépôt, valables dans un worktree (`.worktrees/<nom>`) comme dans le checkout principal.
 * Pas d'`import.meta` ici : Playwright charge les fichiers de test en CJS. La racine est la première
 * `package.json` nommée « recoltos » en remontant depuis `RECOLTOS_ROOT` ou le dossier courant.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

function findRoot(start: string): string {
  let dir = resolve(start)
  for (;;) {
    const pkg = join(dir, 'package.json')
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name === 'recoltos')
          return dir
      } catch {
        /* package.json illisible : on continue de remonter */
      }
    }
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`racine RecoltOS introuvable depuis ${start}`)
    dir = parent
  }
}

export const REPO_ROOT = findRoot(process.env.RECOLTOS_ROOT ?? process.cwd())
/** Toutes les données de test vivent ici (gitignoré), jamais dans `os.tmpdir()`. */
export const TMP_ROOT = resolve(REPO_ROOT, '.tmp')
export const MIGRATIONS_DIR = resolve(REPO_ROOT, 'src/main/db/migrations')
