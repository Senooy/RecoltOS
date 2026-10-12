/**
 * Contrôles du bundle livré,
 * appelés par `pnpm run dist` :
 *  - binaire principal et hôte natif arm64 seuls, `CFBundleIdentifier = com.recoltos.app` ;
 *  - `Info.plist` : association « Ouvrir avec » en `LSHandlerRank = Alternate`,
 *    `CFBundleTypeRole = Viewer`, textes d'autorisation en français ;
 *  - signature : `codesign --verify --deep --strict` ; identité attendue (`RECOLTOS_SIGN_IDENTITY`
 *    ou `--identity`) pour l'app ET l'hôte natif ; exigence désignée stable (certificat, pas cdhash) ;
 *  - fuses lus par `getCurrentFuseWire` : build livré `runAsNode` et `enableNodeCliInspectArguments`
 *    FERMÉS (profil `--profile test` : ouverts, réservé aux tests) ;
 *  - hôte natif SEA présent, exécutable, autonome : `ping` → `pong` sans l'app ;
 *  - extension Chromium + Firefox présentes, version = `EXTENSION_VERSION`, scripts de contenu sans
 *    `import`, aucun code de test (auto-test, faux serveur) ;
 *  - `app.asar` : aucun Mach-O (`.node`, `.dylib`, ffmpeg), aucun `.map`/`.onnx`, preload autonome
 *    (`require` d'`electron` et des modules Node seulement) ;
 *  - aucun binaire d'une autre plateforme, aucun `.map` dans le bundle ;
 *  - tailles mesurées puis figées (budgets ci-dessous).
 *
 *   tsx --tsconfig tsconfig.node.json scripts/check-dist.mts [--app dist/mac-arm64/RecoltOS.app]
 *       [--profile shipped|test] [--identity "RecoltOS Local"] [--json <rapport>]
 *
 * Sans identité demandée, une signature ad hoc est acceptée avec un avertissement (dev seulement).
 */
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses'
import { execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { EXTENSION_ORIGIN, EXTENSION_VERSION } from '../src/shared/bridge/constants'
import { FrameDecoder, encodeFrame } from '../src/host/framing'

const ROOT = resolve(import.meta.dirname, '..')

/** Budgets de taille (Mo), mesurés puis figés : voir `docs/perf.md` § Paquet. */
export const SIZE_BUDGETS_MB = {
  // Mesuré le 2026-10-12 : 370,1 / 2,7 / 20,0 / 106,8 / 0,2 Mo (marge ≈ 8 %).
  app: 400,
  appAsar: 4,
  appAsarUnpacked: 22,
  nativeHost: 115,
  extension: 1,
} as const

export interface Check {
  name: string
  ok: boolean
  detail: string
  warn?: boolean
}

export interface DistReport {
  app: string
  profile: 'shipped' | 'test'
  ok: boolean
  checks: Check[]
  sizesMb: Record<string, number>
}

/** Liste des fichiers d'une archive asar (en-tête JSON lu directement, sans dépendance). */
export function readAsar(file: string): {
  /** Fichiers DANS l'archive (les entrées `unpacked` sont dans `app.asar.unpacked/`). */
  files: string[]
  unpacked: string[]
  read: (p: string) => Buffer | null
} {
  const buf = readFileSync(file)
  const headerSize = buf.readUInt32LE(4)
  const jsonLen = buf.readUInt32LE(12)
  const header = JSON.parse(buf.subarray(16, 16 + jsonLen).toString('utf8')) as AsarDir
  const base = 8 + headerSize
  const files: string[] = []
  const unpacked: string[] = []
  const entries = new Map<string, AsarFile>()
  const walk = (dir: AsarDir, prefix: string) => {
    for (const [name, node] of Object.entries(dir.files)) {
      const p = prefix ? `${prefix}/${name}` : name
      if ('files' in node) walk(node, p)
      else if (node.unpacked) unpacked.push(p)
      else {
        files.push(p)
        entries.set(p, node)
      }
    }
  }
  walk(header, '')
  return {
    files,
    unpacked,
    read: (p) => {
      const e = entries.get(p)
      if (!e || e.unpacked || e.offset === undefined) return null
      const start = base + Number(e.offset)
      return buf.subarray(start, start + e.size)
    },
  }
}
interface AsarFile {
  size: number
  offset?: string
  unpacked?: boolean
}
interface AsarDir {
  files: Record<string, AsarDir | AsarFile>
}

function sh(cmd: string, args: string[]): { ok: boolean; out: string } {
  try {
    return {
      ok: true,
      out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string }
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` || err.message }
  }
}

/** Identité de signature (`codesign -dvv` écrit sur stderr). */
function signInfo(path: string): { authority: string | null; adhoc: boolean; raw: string } {
  const raw = spawnSyncStderr('codesign', ['-dvv', path])
  const authority = /^Authority=(.+)$/m.exec(raw)?.[1]?.trim() ?? null
  return { authority, adhoc: /Signature=adhoc/.test(raw), raw }
}

/** Sortie standard + erreur d'une commande (même en cas d'échec). */
function spawnSyncStderr(cmd: string, args: string[]): string {
  try {
    return execFileSync('/bin/sh', ['-c', `"$0" "$@" 2>&1`, cmd, ...args], { encoding: 'utf8' })
  } catch (e) {
    return String((e as { stdout?: string }).stdout ?? '')
  }
}

/** Taille sur disque, liens symboliques non suivis (les frameworks en contiennent). */
function dirSizeBytes(p: string): number {
  if (!existsSync(p)) return 0
  const st = lstatSync(p)
  if (st.isSymbolicLink()) return 0
  if (!st.isDirectory()) return st.size
  let n = 0
  for (const e of readdirSync(p)) n += dirSizeBytes(join(p, e))
  return n
}

function walkFiles(p: string, out: string[] = []): string[] {
  if (!existsSync(p)) return out
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const f = join(p, e.name)
    if (e.isDirectory()) walkFiles(f, out)
    else out.push(f)
  }
  return out
}

const mb = (b: number) => Math.round((b / 2 ** 20) * 10) / 10

/** Hôte natif lancé comme par un navigateur : `ping` → `pong` (réponse de l'hôte seul). */
async function hostPing(host: string): Promise<{ ok: boolean; detail: string }> {
  const ud = mkdtempSync(join(tmpdir(), 'recolt-checkdist-'))
  try {
    const child = spawn(host, [EXTENSION_ORIGIN], {
      env: { PATH: '/usr/bin:/bin', RECOLTOS_USER_DATA: ud },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    const dec = new FrameDecoder(1024 * 1024)
    const id = 'check-dist-ping'
    const got = await new Promise<boolean>((res) => {
      const timer = setTimeout(() => res(false), 5000)
      child.stdout.on('data', (c: Buffer) => {
        for (const ev of dec.push(c)) {
          const v = ev.kind === 'message' ? (ev.value as { type?: string; re?: string }) : null
          if (v?.type === 'pong' && v.re === id) {
            clearTimeout(timer)
            res(true)
          }
        }
      })
      child.once('error', () => res(false))
      child.stdin.write(encodeFrame({ v: 1, id, type: 'ping' }, 64 * 1024))
    })
    child.stdin.end()
    child.kill('SIGTERM')
    return { ok: got, detail: got ? 'ping → pong' : 'aucun pong en 5 s' }
  } finally {
    rmSync(ud, { recursive: true, force: true })
  }
}

/** `require(...)` d'un bundle : seulement `electron` et les modules Node. */
export function foreignRequires(code: string): string[] {
  const allowed = new Set([...builtinModules, 'electron'])
  const out = new Set<string>()
  for (const m of code.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
    const id = m[1]!.replace(/^node:/, '')
    if (!allowed.has(id) && !allowed.has(id.split('/')[0]!)) out.add(m[1]!)
  }
  for (const m of code.matchAll(/^\s*import\s[^;]*?from\s*["']([^"']+)["']/gm)) out.add(m[1]!)
  return [...out]
}

export async function checkDist(options: {
  app: string
  profile?: 'shipped' | 'test'
  identity?: string
}): Promise<DistReport> {
  const app = resolve(options.app)
  const profile = options.profile ?? 'shipped'
  const identity = options.identity?.trim() || null
  const checks: Check[] = []
  const add = (name: string, ok: boolean, detail: string, warn = false) =>
    checks.push({ name, ok, detail, ...(warn ? { warn } : {}) })
  const C = join(app, 'Contents')
  const R = join(C, 'Resources')
  const bin = join(C, 'MacOS', 'RecoltOS')
  const host = join(R, 'native-host', 'recolt-host')
  if (!existsSync(bin)) {
    add('app présente', false, `${bin} introuvable (pnpm run pack)`)
    return { app, profile, ok: false, checks, sizesMb: {} }
  }

  // Architecture.
  for (const [label, p] of [
    ['binaire principal', bin],
    ['hôte natif', host],
  ] as const) {
    const r = sh('lipo', ['-archs', p])
    add(`${label} arm64 seul`, r.ok && r.out.trim() === 'arm64', r.out.trim())
  }

  // Info.plist.
  const plist = JSON.parse(
    sh('plutil', ['-convert', 'json', '-o', '-', join(C, 'Info.plist')]).out || '{}',
  ) as Record<string, unknown>
  add(
    'CFBundleIdentifier',
    plist.CFBundleIdentifier === 'com.recoltos.app',
    String(plist.CFBundleIdentifier),
  )
  const docTypes = (plist.CFBundleDocumentTypes ?? []) as Record<string, unknown>[]
  add(
    'Info.plist : LSHandlerRank = Alternate, CFBundleTypeRole = Viewer',
    docTypes.length > 0 &&
      docTypes.every((d) => d.LSHandlerRank === 'Alternate' && d.CFBundleTypeRole === 'Viewer'),
    docTypes.map((d) => `${String(d.LSHandlerRank)}/${String(d.CFBundleTypeRole)}`).join(', '),
  )
  const usage = Object.entries(plist).filter(([k]) => /^NS.*UsageDescription$/.test(k))
  const english = usage.filter(
    ([, v]) => !/RecoltOS/.test(String(v)) || /\bthe\b|\bThis app\b/i.test(String(v)),
  )
  add(
    'Info.plist : textes d’autorisation en français',
    english.length === 0,
    english.length ? english.map(([k]) => k).join(', ') : `${usage.length} textes`,
  )

  // Signature.
  const verify = sh('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
  add('codesign --verify --deep --strict', verify.ok, verify.ok ? 'valide' : verify.out.trim())
  const appSign = signInfo(app)
  const hostSign = signInfo(host)
  if (identity) {
    add(
      `identité « ${identity} » (app)`,
      appSign.authority === identity,
      appSign.authority ?? 'ad hoc',
    )
    add(
      `identité « ${identity} » (hôte natif)`,
      hostSign.authority === identity,
      hostSign.authority ?? 'ad hoc',
    )
    const dr = spawnSyncStderr('codesign', ['-d', '-r-', app])
    const line = /designated => (.+)/.exec(dr)?.[1]?.trim() ?? dr.trim()
    add(
      'exigence désignée stable (certificat, pas cdhash)',
      /^identifier "com\.recoltos\.app" and /.test(line) &&
        /\bcertificate leaf(?: = H"[0-9a-f]+"|\[)/i.test(line) &&
        !/\bcdhash\b/.test(line),
      line,
    )
  } else {
    add(
      'signature (aucune identité demandée)',
      true,
      `app : ${appSign.authority ?? 'ad hoc'}, hôte : ${hostSign.authority ?? 'ad hoc'} — dev seulement`,
      appSign.adhoc,
    )
  }
  const hostVerify = sh('codesign', ['--verify', '--strict', host])
  add('hôte natif signé', hostVerify.ok, hostVerify.ok ? 'valide' : hostVerify.out.trim())

  // Fuses.
  const wire = await getCurrentFuseWire(app)
  const open = profile === 'test'
  const expected: [string, FuseV1Options, boolean][] = [
    ['RunAsNode', FuseV1Options.RunAsNode, open],
    ['EnableNodeCliInspectArguments', FuseV1Options.EnableNodeCliInspectArguments, open],
    [
      'EnableNodeOptionsEnvironmentVariable',
      FuseV1Options.EnableNodeOptionsEnvironmentVariable,
      false,
    ],
    ['OnlyLoadAppFromAsar', FuseV1Options.OnlyLoadAppFromAsar, true],
    [
      'EnableEmbeddedAsarIntegrityValidation',
      FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
      false,
    ],
  ]
  for (const [name, idx, on] of expected) {
    const state = (wire as unknown as Record<number, FuseState>)[idx]
    const want = on ? FuseState.ENABLE : FuseState.DISABLE
    add(
      `fuse ${name} ${on ? 'activé' : 'désactivé'}`,
      state === want,
      state === FuseState.ENABLE ? 'activé' : state === FuseState.DISABLE ? 'désactivé' : 'hérité',
    )
  }

  // Hôte natif.
  const hostMode = existsSync(host) ? statSync(host).mode : 0
  add('hôte natif exécutable', (hostMode & 0o111) !== 0, host)
  const ping = existsSync(host) ? await hostPing(host) : { ok: false, detail: 'absent' }
  add('hôte natif autonome', ping.ok, ping.detail)

  // Extension.
  for (const target of ['chromium', 'firefox']) {
    const dir = join(R, 'extension', target)
    const manifest = join(dir, 'manifest.json')
    const v = existsSync(manifest)
      ? (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }).version
      : null
    add(
      `extension ${target} (version ${EXTENSION_VERSION})`,
      v === EXTENSION_VERSION,
      v ?? 'absente',
    )
    const scripts = walkFiles(dir).filter((f) => f.endsWith('.js'))
    const withImport = scripts.filter((f) => /^\s*import\s/m.test(readFileSync(f, 'utf8')))
    add(
      `extension ${target} : scripts sans import`,
      scripts.length > 0 && withImport.length === 0,
      withImport.map((f) => relative(dir, f)).join(', ') || `${scripts.length} scripts`,
    )
    const testCode = scripts.filter((f) =>
      /selfTest|testEndpoints|127\.0\.0\.1/.test(readFileSync(f, 'utf8')),
    )
    add(
      `extension ${target} : aucun code de test`,
      testCode.length === 0,
      testCode.map((f) => relative(dir, f)).join(', ') || 'aucun',
    )
  }

  // app.asar.
  const asarPath = join(R, 'app.asar')
  const asar = readAsar(asarPath)
  const machO = asar.files.filter((f) => /\.(node|dylib)$|(^|\/)(ffmpeg|ffprobe)$/.test(f))
  add(
    'app.asar : aucun Mach-O',
    machO.length === 0,
    machO.join(', ') || `${asar.files.length} fichiers`,
  )
  const maps = asar.files.filter((f) => /\.map$|\.onnx$|(^|\/)models\//.test(f))
  add('app.asar : aucun .map / .onnx', maps.length === 0, maps.slice(0, 5).join(', ') || 'aucun')
  const preload = asar.read('out/preload/index.js')
  const foreign = preload ? foreignRequires(preload.toString('utf8')) : ['(absent)']
  add('preload autonome', foreign.length === 0, foreign.join(', ') || 'electron + Node seulement')
  const leftovers = [...asar.files, ...asar.unpacked].filter((f) =>
    /(^|\/)node_modules\/(node-addon-api|[^/]+\/(src|install|deps))\//.test(f),
  )
  add(
    'app.asar : pas de sources natives ni d’outillage de build',
    leftovers.length === 0,
    leftovers.slice(0, 5).join(', ') || 'aucun',
  )

  // Autres plateformes et sourcemaps dans tout le bundle (hors framework Electron).
  const resources = walkFiles(R)
  const foreignBins = resources.filter((f) =>
    /(linux|linuxmusl|win32|darwin-x64|freebsd|wasm32)[^/]*\.(node|dll|so|dylib)$|sharp-(linux|win32|darwin-x64)/.test(
      f,
    ),
  )
  add(
    'aucun binaire d’une autre plateforme',
    foreignBins.length === 0,
    foreignBins.map((f) => relative(R, f)).join(', ') || 'aucun',
  )
  const resourceMaps = resources.filter((f) => f.endsWith('.map'))
  add(
    'aucun .map dans Resources',
    resourceMaps.length === 0,
    resourceMaps.map((f) => relative(R, f)).join(', ') || 'aucun',
  )

  // Tailles.
  const sizesMb = {
    app: mb(dirSizeBytes(app)),
    appAsar: mb(dirSizeBytes(asarPath)),
    appAsarUnpacked: mb(dirSizeBytes(join(R, 'app.asar.unpacked'))),
    nativeHost: mb(dirSizeBytes(host)),
    extension: mb(dirSizeBytes(join(R, 'extension'))),
    electronFramework: mb(dirSizeBytes(join(C, 'Frameworks', 'Electron Framework.framework'))),
  }
  for (const [k, budget] of Object.entries(SIZE_BUDGETS_MB)) {
    const v = sizesMb[k as keyof typeof sizesMb]
    add(`taille ${k} ≤ ${budget} Mo`, v <= budget, `${v} Mo`)
  }

  return { app, profile, ok: checks.every((c) => c.ok), checks, sizesMb }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { values } = parseArgs({
    options: {
      app: { type: 'string', default: join(ROOT, 'dist/mac-arm64/RecoltOS.app') },
      profile: { type: 'string', default: 'shipped' },
      identity: { type: 'string' },
      json: { type: 'string' },
    },
  })
  const profile = values.profile === 'test' ? 'test' : 'shipped'
  const report = await checkDist({
    app: values.app,
    profile,
    identity: values.identity ?? process.env.RECOLTOS_SIGN_IDENTITY,
  })
  for (const c of report.checks) {
    const mark = !c.ok ? 'ÉCHEC' : c.warn ? 'avert.' : 'ok'
    console.log(`${mark.padEnd(6)} ${c.name} — ${c.detail}`)
  }
  console.log(
    `tailles (Mo) : ${Object.entries(report.sizesMb)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
  )
  const out = values.json ?? join(resolve(values.app, '..', '..'), 'check-dist.json')
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(report.ok ? 'check:dist : vert' : 'check:dist : ÉCHEC')
  process.exit(report.ok ? 0 : 1)
}
