/**
 * Guard for destructive output folders (`make-fixtures.mts`, `seed-bench.mts`, `cloneDir`): these
 * scripts RECURSIVELY DELETE `--out` before writing. A typo (`--out ~`, `--out .`,
 * the real RecoltOS `userData`, the old GatherOS app folder, the import source) must
 * never erase data.
 *
 * Rules of `assertSafeOutDir(out)`:
 *  1. always refused, even with `force`: `/`, `$HOME` and its parents, the repo root and its
 *     parents (including the main checkout when inside a worktree), any path under
 *     `…/Library` or `…/Application Support`, any path containing a "GatherOS" segment;
 *  2. an existing NON-empty folder is only accepted if it carries the `.recolt-fixture` marker
 *     written by these scripts (i.e. a folder they created themselves); `force` changes nothing;
 *  3. outside `<repo>/.tmp` and `os.tmpdir()`, `force` (`--force`) is required;
 *  4. symbolic links are resolved before any check.
 */
import { existsSync, lstatSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { REPO_ROOT } from './paths'

/** File placed in every folder created by `make-fixtures` / `seed-bench`. */
export const FIXTURE_MARKER = '.recolt-fixture'

export interface SafeOutOptions {
  /** Allows a folder outside `<repo>/.tmp` and `os.tmpdir()` (never protected paths). */
  force?: boolean
  /** Repo root (default: the tests' one). */
  repoRoot?: string
  /** Home folder (default: `os.homedir()`). */
  home?: string
  /** System temporary folder (default: `os.tmpdir()`). */
  tmp?: string
}

/** Absolute path with symlinks resolved, even if the end of the path does not exist yet. */
export function realish(p: string): string {
  let current = resolve(p)
  const tail: string[] = []
  for (;;) {
    try {
      const real = realpathSync(current)
      return tail.length === 0 ? real : join(real, ...tail.reverse())
    } catch {
      const parent = dirname(current)
      if (parent === current) return resolve(p)
      tail.push(basename(current))
      current = parent
    }
  }
}

/** `inner` is `outer` or lies under it. */
function within(outer: string, inner: string): boolean {
  const rel = relative(outer, inner)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

const strictlyWithin = (outer: string, inner: string): boolean =>
  inner !== outer && within(outer, inner)

export function protectedReason(target: string, options: SafeOutOptions = {}): string | null {
  const home = realish(options.home ?? homedir())
  const repo = realish(options.repoRoot ?? REPO_ROOT)
  if (dirname(target) === target) return 'la racine du disque'
  if (within(target, home)) return 'le dossier personnel (ou un de ses parents)'
  if (within(target, repo)) return 'la racine du dépôt (ou un de ses parents)'
  const segments = target.split(sep)
  if (segments.some((s) => s.toLowerCase() === 'gatheros'))
    return 'un dossier GatherOS (lecture seule)'
  for (let i = 0; i < segments.length; i++) {
    if (segments[i] === 'Library' && i > 0) return 'un dossier Library (données applicatives)'
    if (segments[i] === 'Application Support') return 'un dossier Application Support'
  }
  return null
}

/**
 * Validates `out` before any deletion and returns its resolved path. Throws an `Error` (message in
 * French) if the folder is refused.
 */
export function assertSafeOutDir(out: string, options: SafeOutOptions = {}): string {
  if (!out || out.trim() === '')
    throw new Error('--out vide : refus de supprimer un dossier non désigné')
  const target = realish(out)

  const why = protectedReason(target, options)
  if (why) throw new Error(`--out ${out} refusé : c'est ${why}. Rien n'a été supprimé.`)

  if (existsSync(target)) {
    const st = lstatSync(target)
    if (!st.isDirectory())
      throw new Error(
        `--out ${out} refusé : existe et n'est pas un dossier. Rien n'a été supprimé.`,
      )
    const entries = readdirSync(target).filter((e) => e !== '.DS_Store')
    if (entries.length > 0 && !entries.includes(FIXTURE_MARKER))
      throw new Error(
        `--out ${out} refusé : dossier non vide qui n'a pas été fabriqué par ce script ` +
          `(marqueur ${FIXTURE_MARKER} absent). Choisir un dossier vide ou inexistant. Rien n'a été supprimé.`,
      )
  }

  if (!options.force) {
    const repo = realish(options.repoRoot ?? REPO_ROOT)
    const zones = [join(repo, '.tmp'), realish(options.tmp ?? tmpdir())]
    if (!zones.some((z) => strictlyWithin(z, target)))
      throw new Error(
        `--out ${out} refusé : hors de <dépôt>/.tmp et du dossier temporaire système ` +
          `(${zones.join(', ')}). Ajouter --force pour l'autoriser. Rien n'a été supprimé.`,
      )
  }
  return target
}

/** Places the marker: the folder can be regenerated without `--force` or confirmation. */
export function markFixtureDir(dir: string, generator: string): void {
  writeFileSync(join(dir, FIXTURE_MARKER), `${generator}\n`)
}
