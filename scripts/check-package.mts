/**
 * `check:pkg`: guardrails for `package.json`.
 * Fails if: a script is named after a built-in pnpm command; a version is not exact
 * (`^`, `~`, `*`, ranges, `latest`); `dependencies` falls outside the allowlist; `packageManager` is
 * not `pnpm@12.6.0+sha512.…`; `"type": "module"` is set (main and preload are CJS).
 * `checkPackage` is pure (tested without disk); the CLI accepts `--file <package.json>`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Built-in pnpm commands: `pnpm <name>` runs them before a script of the same name. */
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
 * Accepted exceptions: `pack` (electron-builder `--dir`) is mandated by the contract itself.
 * Harmless as long as everything is invoked through `pnpm run <script>`.
 */
export const ALLOWED_BUILTIN_SCRIPTS: readonly string[] = ['pack']

/** Only runtime dependencies kept outside the asar (`dependencies` = native modules only). */
export const DEPENDENCIES_ALLOWLIST: readonly string[] = ['better-sqlite3', 'sharp']

export const PACKAGE_MANAGER_PREFIX = 'pnpm@12.6.0+sha512.'

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export interface PackageJsonLike {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  /** Version overrides: npm (`overrides`) and pnpm (`pnpm.overrides`). Same exactness rules. */
  overrides?: Record<string, unknown>
  pnpm?: { overrides?: Record<string, unknown> }
  packageManager?: string
  type?: string
}

function isExactSpec(spec: string): boolean {
  // `npm:alias@1.2.3`, `workspace:*` and `file:` are not used here; only exact versions pass.
  return EXACT_VERSION.test(spec)
}

const unquote = (v: string): string => v.replace(/^(["'])(.*)\1$/, '$2')

/**
 * Check of `pnpm-workspace.yaml`: `overrides`, `catalog` and `catalogs.<name>` carry versions
 * that pnpm 12 applies just like `package.json`. Deliberately limited reader (no YAML dependency):
 * indented `key: value` mappings, without lists or anchors. It FAILS CLOSED: a line in these
 * sections that it cannot read is an error, never a silent pass.
 */
export function checkWorkspace(yamlText: string): string[] {
  const errors: string[] = []
  const SECTIONS = ['overrides', 'catalog', 'catalogs'] as const
  let section: (typeof SECTIONS)[number] | null = null
  let childIndent = -1 // indentation of the section's direct entries
  let catalogName: string | null = null // `catalogs`: current catalog
  let lineNo = 0
  const fail = (why: string): void => {
    errors.push(`pnpm-workspace.yaml line ${lineNo}: ${why} (refused as a precaution)`)
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
        if (value !== '') fail(`"${key}" must be an indented block (inline value refused)`)
      }
      continue
    }
    if (section === null) continue // other pnpm settings: out of scope

    if (childIndent === -1) childIndent = indent
    if (indent < childIndent) {
      fail(`unexpected indentation in "${section}"`)
      continue
    }
    if (section === 'catalogs' && indent === childIndent) {
      // Catalog name: a block only, never a direct version.
      if (key === null || value !== '') {
        fail(`unparseable "catalogs" entry`)
        catalogName = null
        continue
      }
      catalogName = key
      continue
    }
    if (section === 'catalogs' && indent > childIndent && catalogName === null) {
      fail(`"catalogs" entry without a catalog`)
      continue
    }
    if (indent > childIndent && section !== 'catalogs') {
      fail(`unparseable nested entry in "${section}"`)
      continue
    }
    if (key === null) {
      fail(`unparseable line in "${section}"`)
      continue
    }
    const spec = unquote(value)
    const label = section === 'catalogs' ? `catalogs.${catalogName}.${key}` : `${section}.${key}`
    if (spec === '') {
      fail(`"${label}" without a version (unparseable block)`)
    } else if (!isExactSpec(spec)) {
      errors.push(`${label}: version "${spec}" is not exact (no ^, no ~, no range)`)
    }
  }
  return errors
}

export function checkPackage(pkg: PackageJsonLike): string[] {
  const errors: string[] = []

  for (const name of Object.keys(pkg.scripts ?? {})) {
    if (PNPM_BUILTINS.includes(name) && !ALLOWED_BUILTIN_SCRIPTS.includes(name)) {
      errors.push(`script "${name}": collides with a pnpm built-in command`)
    }
  }

  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!isExactSpec(spec)) {
        errors.push(`${field}.${name}: version "${spec}" is not exact (no ^, no ~, no range)`)
      }
    }
  }

  for (const [label, forced] of [
    ['overrides', pkg.overrides],
    ['pnpm.overrides', pkg.pnpm?.overrides],
  ] as const) {
    for (const [name, spec] of Object.entries(forced ?? {})) {
      // A nested (object) or non-string override cannot be checked here: refused.
      if (typeof spec !== 'string' || !isExactSpec(spec)) {
        errors.push(
          `${label}.${name}: version "${typeof spec === 'string' ? spec : JSON.stringify(spec)}" is not exact (no ^, no ~, no range)`,
        )
      }
    }
  }

  for (const name of Object.keys(pkg.dependencies ?? {})) {
    if (!DEPENDENCIES_ALLOWLIST.includes(name)) {
      errors.push(
        `dependencies.${name}: not in the allowlist (${DEPENDENCIES_ALLOWLIST.join(', ')}); move to devDependencies (bundled)`,
      )
    }
  }

  if (!pkg.packageManager?.startsWith(PACKAGE_MANAGER_PREFIX)) {
    errors.push(
      `packageManager: "${pkg.packageManager ?? '(missing)'}"; expected "${PACKAGE_MANAGER_PREFIX}…"`,
    )
  }

  if (pkg.type === 'module') {
    errors.push('"type": "module" is forbidden: main and preload are CJS')
  }

  return errors
}

function main(argv: readonly string[]): number {
  const i = argv.indexOf('--file')
  const value = i >= 0 ? argv[i + 1] : 'package.json'
  if (value === undefined || value === '' || value.startsWith('--')) {
    console.error(
      'check:pkg : --file requires a path (usage: check-package.mts [--file <package.json>])',
    )
    return 2
  }
  const file = resolve(value)
  let pkg: PackageJsonLike
  try {
    pkg = JSON.parse(readFileSync(file, 'utf8')) as PackageJsonLike
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`check:pkg : cannot read ${file} : ${reason}`)
    return 1
  }
  if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) {
    console.error(`check:pkg : ${file} does not contain a JSON object`)
    return 1
  }
  const errors = checkPackage(pkg)
  // pnpm 12 overrides and catalogs: `pnpm-workspace.yaml` next to package.json (absent = nothing to check).
  const workspaceFile = join(dirname(file), 'pnpm-workspace.yaml')
  if (existsSync(workspaceFile)) {
    try {
      errors.push(...checkWorkspace(readFileSync(workspaceFile, 'utf8')))
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error(`check:pkg : cannot read ${workspaceFile} : ${reason}`)
      return 1
    }
  }
  if (errors.length > 0) {
    console.error(`check:pkg : ${errors.length} problem(s) in ${file}`)
    for (const e of errors) console.error(`  - ${e}`)
    return 1
  }
  console.log('check:pkg : package.json is compliant')
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
