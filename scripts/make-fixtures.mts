/**
 * Bibliothèque de démonstration (`pnpm run fixtures`, `pnpm run dev:demo`, projets e2e / visual).
 *
 *   tsx --tsconfig tsconfig.node.json scripts/make-fixtures.mts --out <userData> [--if-missing]
 *       [--count 60] [--collections 6] [--no-cache] [--force]
 *
 * Simple CLI : la fabrication, le cache et le clonage vivent dans `tests/helpers/demo-library.ts`
 * (importable aussi depuis Playwright, qui charge les fichiers de test en CJS).
 *
 * SÉCURITÉ : `--out` est supprimé avant d'être régénéré. `tests/helpers/safe-out.ts` refuse un dossier
 * non vide sans marqueur `.recolt-fixture`, `$HOME`, le dépôt, `Library` / `Application Support` /
 * la référence ; hors `<dépôt>/.tmp` et `os.tmpdir()`, `--force` est exigé.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { makeDemoLibrary } from '../tests/helpers/demo-library'
import { assertSafeOutDir } from '../tests/helpers/safe-out'

/** Entier ≥ 0 d'une option numérique. Refus explicite (sortie 2) plutôt que `NaN` silencieux. */
function parseCount(flag: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const n = raw.trim() === '' ? Number.NaN : Number(raw)
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`--${flag} doit être un entier ≥ 0 (reçu « ${raw} »)`)
  return n
}

/** Analyse des options : une exception de `parseArgs` (option inconnue, valeur absente) devient une erreur d'usage. */
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
  if (values['if-missing'] && existsSync(join(out, 'libraries.json'))) {
    console.log(`fixtures : ${out} existe déjà (--if-missing)`)
    return 0
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
    `fixtures : ${res.items} éléments, ${res.media} médias${res.cached ? ' (cache)' : ''}${res.ffmpeg ? '' : ' (ffmpeg absent : vidéos sans fichier lisible)'} → ${out} en ${Date.now() - t0} ms`,
  )
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
