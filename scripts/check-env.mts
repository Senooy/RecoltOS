/**
 * Environment checks used by `doctor.mts`
 * (`pnpm run check:env`). Three levels: `ok`, `warn` (never blocking: optional tools,
 * wrong pnpm) and `fail` (natives that do not load, FTS5 missing, unsupported platform/Node).
 *
 * Known limitation: with pnpm 9 (e.g. `/opt/homebrew/bin/pnpm` 9.15.0), `pnpm run check:env` fails
 * before reaching the script (`ERROR packages field missing or empty`, due to `pnpm-workspace.yaml`
 * of pnpm 12). The warning « pnpm/9.15.0 détecté » is then only visible with
 * `corepack pnpm run check:env` or `tsx --tsconfig tsconfig.node.json scripts/doctor.mts`.
 */
import { spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, statfsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

export type Level = 'ok' | 'warn' | 'fail'
export interface Check {
  id: string
  level: Level
  label: string
  detail: string
}

export const EXPECTED_PNPM = '12.6.0'
export const LEGACY_PNPM = '9.15.0'
export const SUPPORTED_NODE_MAJORS: readonly number[] = [22, 24]
export const MIN_FREE_GIB = 20

const mk = (id: string, level: Level, label: string, detail: string): Check => ({
  id,
  level,
  label,
  detail,
})

// ---------------------------------------------------------------------------------------------
// Pure functions (tested)

/** `pnpm/12.6.0 npm/? node/v22.22.3 darwin arm64` → `12.6.0` (`null` if absent or another package manager). */
export function parsePnpmUserAgent(ua: string | undefined): string | null {
  const m = /^pnpm\/(\d+\.\d+\.\d+(?:-[\w.]+)?)\b/.exec(ua ?? '')
  return m?.[1] ?? null
}

export function checkPackageManager(
  ua: string | undefined = process.env.npm_config_user_agent,
  whichAll: readonly string[] = [],
): Check {
  const v = parsePnpmUserAgent(ua)
  const where = whichAll.length > 0 ? ` (which -a pnpm : ${whichAll.join(', ')})` : ''
  if (v === EXPECTED_PNPM) return mk('pnpm', 'ok', 'pnpm', `pnpm/${v} (corepack)`)
  if (v === LEGACY_PNPM) {
    return mk(
      'pnpm',
      'warn',
      'pnpm',
      `pnpm/${v} détecté (/opt/homebrew/bin/pnpm ?) : le projet exige pnpm/${EXPECTED_PNPM} via corepack. ` +
        `Lance plutôt « COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm run <script> » (ou place le shim corepack avant Homebrew dans le PATH)${where}.`,
    )
  }
  if (v) {
    return mk('pnpm', 'warn', 'pnpm', `pnpm/${v} détecté ; attendu pnpm/${EXPECTED_PNPM}${where}`)
  }
  return mk(
    'pnpm',
    'warn',
    'pnpm',
    `lancé hors de « pnpm run » (user agent : ${ua ?? 'absent'}) ; attendu pnpm/${EXPECTED_PNPM}${where}`,
  )
}

export function checkNodeVersion(versions: { node: string } = process.versions): Check {
  const major = Number(versions.node.split('.')[0])
  return SUPPORTED_NODE_MAJORS.includes(major)
    ? mk('node', 'ok', 'Node', `v${versions.node}`)
    : mk(
        'node',
        'fail',
        'Node',
        `v${versions.node} : majeure ${SUPPORTED_NODE_MAJORS.join(' ou ')} requise (.node-version)`,
      )
}

export function checkPlatform(platform = process.platform, arch = process.arch): Check {
  return platform === 'darwin' && arch === 'arm64'
    ? mk('platform', 'ok', 'Plateforme', 'macOS arm64')
    : mk('platform', 'fail', 'Plateforme', `${platform} ${arch} : macOS arm64 uniquement`)
}

// ---------------------------------------------------------------------------------------------
// Side effects

const NATIVE_PROBE = `
const D = require('better-sqlite3')
const d = new D(':memory:')
d.exec("create virtual table t using fts5(a); insert into t values('récolte')")
const fts = d.prepare("select count(*) n from t where t match 'recolte'").get().n
const opts = d.pragma('compile_options').some((r) => /ENABLE_FTS5/.test(r.compile_options))
const v = d.prepare('select sqlite_version() v').get().v
const sharp = require('sharp')
process.stdout.write(JSON.stringify({ abi: process.versions.modules, electron: process.versions.electron ?? null, node: process.versions.node, sqlite: v, fts, opts, vips: sharp.versions.vips }))
`

interface Probe {
  abi: string
  electron: string | null
  node: string
  sqlite: string
  fts: number
  opts: boolean
  vips: string
}

function runProbe(cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) {
  const r = spawnSync(cmd, args, { env, cwd, encoding: 'utf8', timeout: 60_000 })
  if (r.error) return { error: r.error.message } as const
  if (r.status !== 0) {
    return {
      error: (r.stderr || r.stdout || `code ${r.status}`).trim().split('\n').slice(-3).join(' | '),
    } as const
  }
  try {
    return { probe: JSON.parse(r.stdout) as Probe } as const
  } catch {
    return { error: `sortie illisible : ${r.stdout.slice(0, 120)}` } as const
  }
}

function describeProbe(id: string, label: string, res: ReturnType<typeof runProbe>): Check {
  if ('error' in res) return mk(id, 'fail', label, `échec du chargement des natifs : ${res.error}`)
  const p = res.probe
  if (p.fts !== 1 || !p.opts)
    return mk(id, 'fail', label, 'FTS5 absent (les triggers du schéma en dépendent)')
  return mk(
    id,
    'ok',
    label,
    `better-sqlite3 + FTS5 (SQLite ${p.sqlite}), sharp (libvips ${p.vips}), ABI ${p.abi}`,
  )
}

export function checkNativesInNode(root: string): Check {
  return describeProbe(
    'natives-node',
    `Natifs sous Node ${process.versions.node}`,
    runProbe(process.execPath, ['-e', NATIVE_PROBE], { ...process.env }, root),
  )
}

export function checkNativesInElectron(root: string): Check {
  let exe: string
  try {
    exe = createRequire(join(root, 'package.json'))('electron') as string
  } catch (err) {
    return mk(
      'natives-electron',
      'fail',
      'Natifs sous Electron',
      `binaire Electron introuvable (${(err as Error).message.split('\n')[0]}). ` +
        'Si `node_modules/electron/dist` manque : `node node_modules/electron/install.js`.',
    )
  }
  if (typeof exe !== 'string' || !existsSync(exe)) {
    return mk(
      'natives-electron',
      'fail',
      'Natifs sous Electron',
      `exécutable absent : ${String(exe)}`,
    )
  }
  const res = runProbe(
    exe,
    ['-e', NATIVE_PROBE],
    { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    root,
  )
  const check = describeProbe('natives-electron', 'Natifs sous Electron', res)
  const version = 'probe' in res ? res.probe?.electron : null
  return check.level === 'ok' && version
    ? { ...check, label: `Natifs sous Electron ${version}` }
    : check
}

/** Same resolution order as `platform/binaries.ts`, plus the CLI tool locations. */
export function candidateDirs(): string[] {
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/usr/sbin',
    join(homedir(), '.hermes/node/bin'),
    join(homedir(), '.local/bin'),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
  ]
}

export function findExecutable(
  name: string,
  dirs: readonly string[] = candidateDirs(),
): string | null {
  for (const d of dirs) {
    const p = join(d, name)
    try {
      accessSync(p, constants.X_OK)
      return p
    } catch {
      /* next */
    }
  }
  return null
}

function toolVersion(path: string, args: string[]): string {
  const r = spawnSync(path, args, { encoding: 'utf8', timeout: 15_000 })
  return `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n')[0]?.trim() ?? ''
}

export function checkOptionalTools(): Check[] {
  const specs: { id: string; label: string; bin: string; args: string[]; hint: string }[] = [
    {
      id: 'ffmpeg',
      label: 'ffmpeg',
      bin: 'ffmpeg',
      args: ['-version'],
      hint: 'brew install ffmpeg (mode dégradé sans vidéo)',
    },
    {
      id: 'ffprobe',
      label: 'ffprobe',
      bin: 'ffprobe',
      args: ['-version'],
      hint: 'fourni par ffmpeg (Homebrew)',
    },
    {
      id: 'sips',
      label: 'sips',
      bin: 'sips',
      args: ['--version'],
      hint: 'outil système macOS (/usr/bin/sips)',
    },
    {
      id: 'claude',
      label: 'claude (CLI)',
      bin: 'claude',
      args: ['--version'],
      hint: 'IA désactivée tant que la CLI manque',
    },
    {
      id: 'codex',
      label: 'codex (CLI)',
      bin: 'codex',
      args: ['--version'],
      hint: 'secours IA indisponible',
    },
  ]
  return specs.map((s) => {
    const path = findExecutable(s.bin)
    return path
      ? mk(s.id, 'ok', s.label, `${path} — ${toolVersion(path, s.args)}`)
      : mk(s.id, 'warn', s.label, `introuvable (${s.hint})`)
  })
}

export function checkDisk(root: string): Check {
  try {
    const s = statfsSync(root)
    const gib = (s.bavail * s.bsize) / 1024 ** 3
    return gib >= MIN_FREE_GIB
      ? mk('disk', 'ok', 'Disque', `${gib.toFixed(0)} Gio libres`)
      : mk(
          'disk',
          'warn',
          'Disque',
          `${gib.toFixed(1)} Gio libres (< ${MIN_FREE_GIB} Gio recommandés)`,
        )
  } catch (err) {
    return mk('disk', 'warn', 'Disque', `mesure impossible : ${(err as Error).message}`)
  }
}

export function checkXcode(): Check {
  const r = spawnSync('xcode-select', ['-p'], { encoding: 'utf8' })
  return r.status === 0
    ? mk('xcode', 'ok', 'Xcode', r.stdout.trim())
    : mk(
        'xcode',
        'warn',
        'Xcode',
        'xcode-select -p a échoué (nécessaire pour iconutil et la signature)',
      )
}

export function checkSignIdentity(): Check | null {
  const id = process.env.RECOLTOS_SIGN_IDENTITY
  if (!id) return null
  const r = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
  })
  return r.stdout?.includes(id)
    ? mk('sign', 'ok', 'Identité de signature', id)
    : mk(
        'sign',
        'warn',
        'Identité de signature',
        `« ${id} » absente du Trousseau (security find-identity -v -p codesigning)`,
      )
}

export function whichAllPnpm(): string[] {
  const r = spawnSync('/usr/bin/which', ['-a', 'pnpm'], { encoding: 'utf8', env: process.env })
  return [...new Set(r.stdout.split('\n').filter(Boolean))]
}

export function runChecks(root: string): Check[] {
  const pm = checkPackageManager(
    process.env.npm_config_user_agent,
    parsePnpmUserAgent(process.env.npm_config_user_agent) === EXPECTED_PNPM ? [] : whichAllPnpm(),
  )
  const out: Check[] = [checkNodeVersion(), checkPlatform(), pm]
  // Natives are probed in all cases, including outside a supported platform: a loading failure
  // is then read from their detail; it is not discarded.
  out.push(checkNativesInNode(root), checkNativesInElectron(root))
  out.push(...checkOptionalTools(), checkDisk(root), checkXcode())
  const sign = checkSignIdentity()
  if (sign) out.push(sign)
  return out
}
