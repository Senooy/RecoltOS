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
  if (dirname(target) === target) return 'the disk root'
  if (within(target, home)) return 'the home folder (or one of its parents)'
  if (within(target, repo)) return 'the repository root (or one of its parents)'
  const segments = target.split(sep)
  if (segments.some((s) => s.toLowerCase() === 'gatheros')) return 'a GatherOS folder (read-only)'
  for (let i = 0; i < segments.length; i++) {
    if (segments[i] === 'Library' && i > 0) return 'a Library folder (application data)'
    if (segments[i] === 'Application Support') return 'an Application Support folder'
  }
  return null
}

/**
 * Validates `out` before any deletion and returns its resolved path. Throws an `Error` if the folder is refused.
 */
export function assertSafeOutDir(out: string, options: SafeOutOptions = {}): string {
  if (!out || out.trim() === '')
    throw new Error('--out is empty: refusing to delete an unspecified folder')
  const target = realish(out)

  const why = protectedReason(target, options)
  if (why) throw new Error(`--out ${out} refused: it is ${why}. Nothing was deleted.`)

  if (existsSync(target)) {
    const st = lstatSync(target)
    if (!st.isDirectory())
      throw new Error(`--out ${out} refused: exists and is not a folder. Nothing was deleted.`)
    const entries = readdirSync(target).filter((e) => e !== '.DS_Store')
    if (entries.length > 0 && !entries.includes(FIXTURE_MARKER))
      throw new Error(
        `--out ${out} refused: non-empty folder not created by this script ` +
          `(marker ${FIXTURE_MARKER} missing). Choose an empty or non-existent folder. Nothing was deleted.`,
      )
  }

  if (!options.force) {
    const repo = realish(options.repoRoot ?? REPO_ROOT)
    const zones = [join(repo, '.tmp'), realish(options.tmp ?? tmpdir())]
    if (!zones.some((z) => strictlyWithin(z, target)))
      throw new Error(
        `--out ${out} refused: outside <repo>/.tmp and the system temp folder ` +
          `(${zones.join(', ')}). Add --force to allow it. Nothing was deleted.`,
      )
  }
  return target
}

/** Places the marker: the folder can be regenerated without `--force` or confirmation. */
export function markFixtureDir(dir: string, generator: string): void {
  writeFileSync(join(dir, FIXTURE_MARKER), `${generator}\n`)
}
