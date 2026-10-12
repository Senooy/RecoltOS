/**
 * Démarrage de l'app PACKAGÉE : `process.uptime()` du main à la réception de la
 * marque `grid-painted` (première image de la grille avec des cartes), lue dans
 * `<userData>/logs/perf.jsonl`. Un lancement d'échauffement (caches OS chauds), puis N lancements
 * mesurés ; chaque lancement attend la marque, quitte l'app et attend sa sortie.
 *
 *   tsx --tsconfig tsconfig.node.json scripts/perf-startup.mts --user-data <dossier> [--runs 5]
 *       [--app dist/mac-arm64/RecoltOS.app] [--json <rapport>]
 *
 * `--user-data` : bibliothèque de mesure (ex. clone APFS de `.tmp/m3-real`), jamais le dossier réel
 * de l'utilisateur. `RECOLTOS_HOME` pointe vers un dossier temporaire : aucun manifest natif écrit
 * dans `~/Library`.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const ROOT = resolve(import.meta.dirname, '..')

export interface StartupReport {
  app: string
  runs: number[]
  medianMs: number
  maxMs: number
  appMountedMs: number[]
}

function marks(file: string): { name: string; uptime: number }[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { name: string; uptime: number })
}

async function launchOnce(
  bin: string,
  userData: string,
  home: string,
  timeoutMs = 30_000,
): Promise<{ grid: number; mounted: number | null }> {
  const log = join(userData, 'logs', 'perf.jsonl')
  rmSync(log, { force: true })
  const child = spawn(bin, [], {
    env: {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin',
      HOME: process.env.HOME ?? homedir(),
      RECOLTOS_USER_DATA: userData,
      RECOLTOS_HOME: home,
      LANG: 'fr_FR.UTF-8',
    },
    stdio: 'ignore',
  })
  const exited = new Promise<void>((r) => child.once('exit', () => r()))
  try {
    const t0 = Date.now()
    for (;;) {
      const found = marks(log)
      const grid = found.find((m) => m.name === 'grid-painted')
      if (grid) {
        const mounted = found.find((m) => m.name === 'app-mounted')
        return { grid: grid.uptime * 1000, mounted: mounted ? mounted.uptime * 1000 : null }
      }
      if (Date.now() - t0 > timeoutMs)
        throw new Error('marque grid-painted absente (délai dépassé)')
      if (child.exitCode !== null) throw new Error(`l'app s'est arrêtée (code ${child.exitCode})`)
      await new Promise((r) => setTimeout(r, 50))
    }
  } finally {
    child.kill('SIGTERM')
    await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))])
    if (child.exitCode === null) child.kill('SIGKILL')
    await new Promise((r) => setTimeout(r, 800))
  }
}

export async function measureStartup(options: {
  app: string
  userData: string
  runs?: number
}): Promise<StartupReport> {
  const real = join(homedir(), 'Library', 'Application Support', 'RecoltOS')
  if (resolve(options.userData).startsWith(real)) {
    throw new Error(
      `refus : ${options.userData} est le dossier réel de RecoltOS (utilise un clone)`,
    )
  }
  const bin = join(options.app, 'Contents', 'MacOS', 'RecoltOS')
  if (!existsSync(bin)) throw new Error(`${bin} introuvable (pnpm run pack)`)
  const home = mkdtempSync(join(tmpdir(), 'recolt-startup-home-'))
  try {
    await launchOnce(bin, options.userData, home) // échauffement
    const runs: number[] = []
    const appMountedMs: number[] = []
    for (let i = 0; i < (options.runs ?? 5); i++) {
      const r = await launchOnce(bin, options.userData, home)
      runs.push(Math.round(r.grid))
      if (r.mounted !== null) appMountedMs.push(Math.round(r.mounted))
    }
    const sorted = [...runs].sort((a, b) => a - b)
    return {
      app: options.app,
      runs,
      medianMs: sorted[Math.floor(sorted.length / 2)]!,
      maxMs: sorted[sorted.length - 1]!,
      appMountedMs,
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { values } = parseArgs({
    options: {
      'user-data': { type: 'string' },
      runs: { type: 'string', default: '5' },
      app: { type: 'string', default: join(ROOT, 'dist/mac-arm64/RecoltOS.app') },
      json: { type: 'string' },
    },
  })
  if (!values['user-data']) {
    console.error('--user-data <dossier> requis (clone de mesure, jamais le dossier réel)')
    process.exit(2)
  }
  const report = await measureStartup({
    app: resolve(values.app),
    userData: resolve(values['user-data']),
    runs: Number(values.runs),
  })
  console.log(JSON.stringify(report))
  if (values.json) writeFileSync(values.json, JSON.stringify(report, null, 2))
}
