/**
 * Repository paths, valid in a worktree (`.worktrees/<name>`) as well as in the main checkout.
 * No `import.meta` here: Playwright loads test files as CJS. The root is the first
 * `package.json` named "recoltos" walking up from `RECOLTOS_ROOT` or the current folder.
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
        /* package.json unreadable: keep walking up */
      }
    }
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`RecoltOS root not found from ${start}`)
    dir = parent
  }
}

export const REPO_ROOT = findRoot(process.env.RECOLTOS_ROOT ?? process.cwd())
/** All test data lives here (gitignored), never in `os.tmpdir()`. */
export const TMP_ROOT = resolve(REPO_ROOT, '.tmp')
export const MIGRATIONS_DIR = resolve(REPO_ROOT, 'src/main/db/migrations')
