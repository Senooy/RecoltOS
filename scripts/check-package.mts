/**
 * `check:pkg` (QA §3.5, PLAN §1.15, §2.11) : garde-fous du `package.json`.
 * Échoue si : un script porte le nom d'une commande intégrée de pnpm ; une version n'est pas exacte
 * (`^`, `~`, `*`, plages, `latest`) ; `dependencies` sort de la liste blanche ; `packageManager` n'est
 * pas `pnpm@12.6.0+sha512.…` ; `"type": "module"` est posé (main et preload sont en CJS, PLAN §1.14).
 * `checkPackage` est pure (testée sans disque) ; le CLI accepte `--file <package.json>`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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
  /** Forçages de version : npm (`overrides`) et pnpm (`pnpm.overrides`). Mêmes règles d'exactitude. */
  overrides?: Record<string, unknown>
  pnpm?: { overrides?: Record<string, unknown> }
  packageManager?: string
  type?: string
}

function isExactSpec(spec: string): boolean {
  // `npm:alias@1.2.3`, `workspace:*` et `file:` ne sont pas utilisés ici ; seules les versions exactes passent.
  return EXACT_VERSION.test(spec)
}

const unquote = (v: string): string => v.replace(/^(["'])(.*)\1$/, '$2')

/**
 * Contrôle de `pnpm-workspace.yaml` (PLAN §2.11) : `overrides`, `catalog` et `catalogs.<nom>` portent
 * des versions que pnpm 12 applique comme `package.json`. Lecteur volontairement restreint (pas de
 * dépendance YAML) : mappings `clé: valeur` indentés, sans listes ni ancres. Il ÉCHOUE FERMÉ : une ligne
 * de ces sections qu'il ne sait pas lire est une erreur, jamais un passage silencieux.
 */
export function checkWorkspace(yamlText: string): string[] {
  const errors: string[] = []
  const SECTIONS = ['overrides', 'catalog', 'catalogs'] as const
  let section: (typeof SECTIONS)[number] | null = null
  let childIndent = -1 // indentation des entrées directes de la section
  let catalogName: string | null = null // `catalogs` : catalogue courant
  let lineNo = 0
  const fail = (why: string): void => {
    errors.push(`pnpm-workspace.yaml ligne ${lineNo} : ${why} (refus par prudence)`)
  }
  for (const raw of yamlText.split(/\r?\n/)) {
    lineNo++
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = raw.length - raw.trimStart().length
    const colon = trimmed.indexOf(':')
    const key = colon > 0 ? unquote(trimmed.slice(0, colon).trim()) : null
    const value =
      colon > 0
        ? trimmed
            .slice(colon + 1)
            .replace(/\s+#.*$/, '')
            .trim()
        : ''

    if (indent === 0) {
      section = null
      childIndent = -1
      catalogName = null
      if (key !== null && (SECTIONS as readonly string[]).includes(key)) {
        section = key as (typeof SECTIONS)[number]
        if (value !== '') fail(`« ${key} » doit être un bloc indenté (valeur en ligne refusée)`)
      }
      continue
    }
    if (section === null) continue // autres réglages pnpm : hors périmètre

    if (childIndent === -1) childIndent = indent
    if (indent < childIndent) {
      fail(`indentation inattendue dans « ${section} »`)
      continue
    }
    if (section === 'catalogs' && indent === childIndent) {
      // Nom de catalogue : seulement un bloc, jamais une version directe.
      if (key === null || value !== '') {
        fail(`entrée de « catalogs » non analysable`)
        catalogName = null
        continue
      }
      catalogName = key
      continue
    }
    if (section === 'catalogs' && indent > childIndent && catalogName === null) {
      fail(`entrée de « catalogs » sans catalogue`)
      continue
    }
    if (indent > childIndent && section !== 'catalogs') {
      fail(`entrée imbriquée non analysable dans « ${section} »`)
      continue
    }
    if (key === null) {
      fail(`ligne non analysable dans « ${section} »`)
      continue
    }
    const spec = unquote(value)
    const label = section === 'catalogs' ? `catalogs.${catalogName}.${key}` : `${section}.${key}`
    if (spec === '') {
      fail(`« ${label} » sans version (bloc non analysable)`)
    } else if (!isExactSpec(spec)) {
      errors.push(`${label} : version « ${spec} » non exacte (ni ^, ni ~, ni plage ; PLAN §2.11)`)
    }
  }
  return errors
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

  for (const [label, forced] of [
    ['overrides', pkg.overrides],
    ['pnpm.overrides', pkg.pnpm?.overrides],
  ] as const) {
    for (const [name, spec] of Object.entries(forced ?? {})) {
      // Un forçage imbriqué (objet) ou non textuel n'est pas contrôlable ici : refusé.
      if (typeof spec !== 'string' || !isExactSpec(spec)) {
        errors.push(
          `${label}.${name} : version « ${typeof spec === 'string' ? spec : JSON.stringify(spec)} » non exacte (ni ^, ni ~, ni plage ; PLAN §2.11)`,
        )
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
  const value = i >= 0 ? argv[i + 1] : 'package.json'
  if (value === undefined || value === '' || value.startsWith('--')) {
    console.error(
      'check:pkg : --file exige un chemin (usage : check-package.mts [--file <package.json>])',
    )
    return 2
  }
  const file = resolve(value)
  let pkg: PackageJsonLike
  try {
    pkg = JSON.parse(readFileSync(file, 'utf8')) as PackageJsonLike
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`check:pkg : lecture impossible de ${file} : ${reason}`)
    return 1
  }
  if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) {
    console.error(`check:pkg : ${file} ne contient pas un objet JSON`)
    return 1
  }
  const errors = checkPackage(pkg)
  // Forçages et catalogues pnpm 12 : `pnpm-workspace.yaml` à côté du package.json (absent = rien à contrôler).
  const workspaceFile = join(dirname(file), 'pnpm-workspace.yaml')
  if (existsSync(workspaceFile)) {
    try {
      errors.push(...checkWorkspace(readFileSync(workspaceFile, 'utf8')))
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error(`check:pkg : lecture impossible de ${workspaceFile} : ${reason}`)
      return 1
    }
  }
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
