/**
 * Test temporary folders under `<repo>/.tmp/tests/` (gitignored, one `userData` per worktree).
 * Cleanup: `removeAllTmpDirs()` is called by `tests/setup/node.ts` (`afterAll` of each file
 * vitest — `process.on('exit')` does not run in vitest `forks` workers); the hook
 * `exit` remains for Playwright and the scripts. `purgeStaleTmpDirs()` (globalSetup) removes
 * what killed runs left behind. `removeTmpDir` for early cleanup.
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

/** Creates an empty, unique folder; `label` is only used for debugging (`.tmp/tests/<label>-XXXXXX`). */
export function makeTmpDir(label = 'test'): string {
  const base = join(TMP_ROOT, 'tests')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, `${label.replace(/[^\w.-]+/g, '_')}-`))
  created.add(dir)
  installExitHook()
  return dir
}

/** Removes all folders created by this process (`afterAll` hook of vitest tests). */
export function removeAllTmpDirs(): void {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
  created.clear()
}

/**
 * Removes from `.tmp/tests/` the folders older than `maxAgeMs` (10 min by default): leftovers
 * of interrupted runs. The threshold avoids deleting the folders of another running process
 * (Playwright run in parallel in the same worktree).
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
      /* folder disappeared in the meantime or unreadable: ignored */
    }
  }
  return removed
}

export function removeTmpDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
  created.delete(dir)
}

/** Runs `fn` in a temporary folder, removed afterwards (even on failure). */
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
