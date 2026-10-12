/**
 * Demo library (`pnpm run fixtures`, `pnpm run dev:demo`, e2e / visual projects).
 *
 *   tsx --tsconfig tsconfig.node.json scripts/make-fixtures.mts --out <userData> [--if-missing]
 *       [--count 60] [--collections 6] [--no-cache] [--force]
 *
 * Simple CLI: generation, cache and cloning live in `tests/helpers/demo-library.ts`
 * (also importable from Playwright, which loads test files as CJS).
 *
 * SECURITY: `--out` is deleted before being regenerated. `tests/helpers/safe-out.ts` refuses a
 * non-empty directory without a `.recolt-fixture` marker, `$HOME`, the repository,
 * `Library` / `Application Support`; outside `<repo>/.tmp` and `os.tmpdir()`, `--force` is required.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { isDemoLibraryCurrent, makeDemoLibrary } from '../tests/helpers/demo-library'
import { assertSafeOutDir } from '../tests/helpers/safe-out'

/** Integer ≥ 0 for a numeric option. Explicit refusal (exit 2) rather than a silent `NaN`. */
function parseCount(flag: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const n = raw.trim() === '' ? Number.NaN : Number(raw)
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`--${flag} must be an integer >= 0 (got "${raw}")`)
  return n
}

/** Option parsing: an exception from `parseArgs` (unknown option, missing value) becomes a usage error. */
function parseOptions(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    options: {
      out: { type: 'string' },
      'if-missing': { type: 'boolean', default: false },
      count: { type: 'string' },
      collections: { type: 'string' },
      trashed: { type: 'string' },
      hidden: { type: 'string' },
      'no-cache': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
  })
}

async function main(argv: readonly string[]): Promise<number> {
  let values: ReturnType<typeof parseOptions>['values']
  try {
    ;({ values } = parseOptions(argv))
  } catch (e) {
    console.error(`fixtures : ${(e as Error).message}`)
    console.error(
      'usage : make-fixtures.mts --out <userData> [--if-missing] [--count N] [--collections N] [--no-cache] [--force]',
    )
    return 2
  }
  if (!values.out) {
    console.error(
      'usage : make-fixtures.mts --out <userData> [--if-missing] [--count N] [--collections N] [--no-cache] [--force]',
    )
    return 2
  }
  const out = resolve(values.out)
  if (values['if-missing']) {
    // A copy older than the latest migration (stale user_version) is regenerated, not reused.
    if (isDemoLibraryCurrent(out)) {
      console.log(`fixtures : ${out} already exists and is up to date (--if-missing)`)
      return 0
    }
    if (existsSync(join(out, 'libraries.json')))
      console.log(`fixtures : ${out} is stale or incomplete, regenerating (--if-missing)`)
  }
  const t0 = Date.now()
  try {
    assertSafeOutDir(out, { force: values.force })
  } catch (e) {
    console.error(`fixtures : ${(e as Error).message}`)
    return 2
  }
  let counts: Parameters<typeof makeDemoLibrary>[1]
  try {
    counts = {
      count: parseCount('count', values.count),
      collections: parseCount('collections', values.collections),
      trashed: parseCount('trashed', values.trashed),
      hidden: parseCount('hidden', values.hidden),
    }
  } catch (e) {
    console.error(`fixtures : ${(e as Error).message}`)
    console.error(
      'usage : make-fixtures.mts --out <userData> [--if-missing] [--count N] [--collections N] [--no-cache] [--force]',
    )
    return 2
  }
  const res = await makeDemoLibrary(out, counts, !values['no-cache'], { force: values.force })
  console.log(
    `fixtures : ${res.items} items, ${res.media} media${res.cached ? ' (cache)' : ''}${res.ffmpeg ? '' : ' (ffmpeg not found: videos without a readable file)'} → ${out} in ${Date.now() - t0} ms`,
  )
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
