/**
 * `check:pkg` (QA §3.5, PLAN §1.15, §2.11) : garde-fous du `package.json`.
 * Échoue si : un script porte le nom d'une commande intégrée de pnpm ; une version n'est pas exacte
 * (`^`, `~`, `*`, plages, `latest`) ; `dependencies` sort de la liste blanche ; `packageManager` n'est
 * pas `pnpm@12.6.0+sha512.…` ; `"type": "module"` est posé (main et preload sont en CJS, PLAN §1.14).
 * `checkPackage` est pure (testée sans disque) ; le CLI accepte `--file <package.json>`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Commandes intégrées de pnpm : `pnpm <nom>` les exécute avant un script du même nom (QA §3.5). */
export const PNPM_BUILTINS: readonly string[] = [
  'doctor',
  'rebuild',
  'install',
  'add',
  'update',
  'remove',
  'link',
  'unlink',
  'list',
  'outdated',
  'audit',
  'dedupe',
  'fetch',
  'deploy',
  'exec',
  'dlx',
  'env',
  'patch',
  'prune',
  'publish',
  'pack',
  'root',
  'store',
  'why',
  'import',
  'init',
  'setup',
  'licenses',
  'config',
  'create',
  'approve-builds',
]

/**
 * Exceptions assumées : `pack` (electron-builder `--dir`) est imposé par le contrat de WP-00 et QA §3.5
 * lui-même. Sans risque tant que tout est appelé par `pnpm run <script>` (PLAN §1.15).
 */
export const ALLOWED_BUILTIN_SCRIPTS: readonly string[] = ['pack']

/** Seules dépendances d'exécution externes à l'asar (PLAN §3 : `dependencies` = natifs uniquement). */
export const DEPENDENCIES_ALLOWLIST: readonly string[] = ['better-sqlite3', 'sharp']

export const PACKAGE_MANAGER_PREFIX = 'pnpm@12.6.0+sha512.'

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export interface PackageJsonLike {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  packageManager?: string
  type?: string
}

function isExactSpec(spec: string): boolean {
  // `npm:alias@1.2.3`, `workspace:*` et `file:` ne sont pas utilisés ici ; seules les versions exactes passent.
  return EXACT_VERSION.test(spec)
}

export function checkPackage(pkg: PackageJsonLike): string[] {
  const errors: string[] = []

  for (const name of Object.keys(pkg.scripts ?? {})) {
    if (PNPM_BUILTINS.includes(name) && !ALLOWED_BUILTIN_SCRIPTS.includes(name)) {
      errors.push(`script « ${name} » : collision avec une commande intégrée de pnpm`)
    }
  }

  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!isExactSpec(spec)) {
        errors.push(`${field}.${name} : version « ${spec} » non exacte (ni ^, ni ~, ni plage)`)
      }
    }
  }

  for (const name of Object.keys(pkg.dependencies ?? {})) {
    if (!DEPENDENCIES_ALLOWLIST.includes(name)) {
      errors.push(
        `dependencies.${name} : hors liste blanche (${DEPENDENCIES_ALLOWLIST.join(', ')}) ; à placer en devDependencies (bundlé)`,
      )
    }
  }

  if (!pkg.packageManager?.startsWith(PACKAGE_MANAGER_PREFIX)) {
    errors.push(
      `packageManager : « ${pkg.packageManager ?? '(absent)'} » ; attendu « ${PACKAGE_MANAGER_PREFIX}… » (PLAN §1.15)`,
    )
  }

  if (pkg.type === 'module') {
    errors.push('"type": "module" interdit : main et preload sont en CJS (PLAN §1.14)')
  }

  return errors
}

function main(argv: readonly string[]): number {
  const i = argv.indexOf('--file')
  const file = resolve(i >= 0 && argv[i + 1] ? argv[i + 1]! : 'package.json')
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as PackageJsonLike
  const errors = checkPackage(pkg)
  if (errors.length > 0) {
    console.error(`check:pkg : ${errors.length} problème(s) dans ${file}`)
    for (const e of errors) console.error(`  - ${e}`)
    return 1
  }
  console.log('check:pkg : package.json conforme')
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
