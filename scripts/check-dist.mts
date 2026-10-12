/**
 * Checks on the shipped bundle,
 * called by `pnpm run dist`:
 *  - main binary and arm64 native host only, `CFBundleIdentifier = com.recoltos.app`;
 *  - `Info.plist`: "Open With" association as `LSHandlerRank = Alternate`,
 *    `CFBundleTypeRole = Viewer`, usage-description texts in French;
 *  - signature: `codesign --verify --deep --strict`; expected identity (`RECOLTOS_SIGN_IDENTITY`
 *    or `--identity`) for the app AND the native host; stable designated requirement (certificate, not cdhash);
 *  - fuses read by `getCurrentFuseWire`: shipped build has `runAsNode` and `enableNodeCliInspectArguments`
 *    CLOSED (`--profile test` profile: open, reserved for tests);
 *  - SEA native host present, executable, standalone: `ping` → `pong` without the app;
 *  - Chromium + Firefox extensions present, version = `EXTENSION_VERSION`, content scripts without
 *    `import`, no test code (self-test, fake server);
 *  - `app.asar`: no Mach-O (`.node`, `.dylib`, ffmpeg), no `.map`/`.onnx`, standalone preload
 *    (`require` of `electron` and Node modules only);
 *  - no binary of another platform, no `.map` in the bundle;
 *  - sizes measured then frozen (budgets below).
 *
 *   tsx --tsconfig tsconfig.node.json scripts/check-dist.mts [--app dist/mac-arm64/RecoltOS.app]
 *       [--profile shipped|test] [--identity "RecoltOS Local"] [--json <report>]
 *
 * Without a requested identity, an ad hoc signature is accepted with a warning (dev only).
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

/** Size budgets (MB), measured then frozen: see `docs/perf.md` § Paquet. */
export const SIZE_BUDGETS_MB = {
  // Measured on 2026-10-12: 370.1 / 2.7 / 20.0 / 106.8 / 0.2 MB (margin ≈ 8 %).
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

/** List of the files of an asar archive (JSON header read directly, without dependency). */
export function readAsar(file: string): {
  /** Files IN the archive (`unpacked` entries are in `app.asar.unpacked/`). */
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

/** Signature identity (`codesign -dvv` writes to stderr). */
function signInfo(path: string): { authority: string | null; adhoc: boolean; raw: string } {
  const raw = spawnSyncStderr('codesign', ['-dvv', path])
  const authority = /^Authority=(.+)$/m.exec(raw)?.[1]?.trim() ?? null
  return { authority, adhoc: /Signature=adhoc/.test(raw), raw }
}

/** Standard output + error of a command (even on failure). */
function spawnSyncStderr(cmd: string, args: string[]): string {
  try {
    return execFileSync('/bin/sh', ['-c', `"$0" "$@" 2>&1`, cmd, ...args], { encoding: 'utf8' })
  } catch (e) {
    return String((e as { stdout?: string }).stdout ?? '')
  }
}

/** Size on disk, symbolic links not followed (frameworks contain some). */
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

/** Native host launched as a browser would: `ping` → `pong` (reply from the host alone). */
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
    return { ok: got, detail: got ? 'ping → pong' : 'no pong within 5 s' }
  } finally {
    rmSync(ud, { recursive: true, force: true })
  }
}

/** `require(...)` of a bundle: only `electron` and the Node modules. */
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
    add('app present', false, `${bin} not found (pnpm run pack)`)
    return { app, profile, ok: false, checks, sizesMb: {} }
  }

  // Architecture.
  for (const [label, p] of [
    ['main binary', bin],
    ['native host', host],
  ] as const) {
    const r = sh('lipo', ['-archs', p])
    add(`${label} arm64 only`, r.ok && r.out.trim() === 'arm64', r.out.trim())
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
    'Info.plist: LSHandlerRank = Alternate, CFBundleTypeRole = Viewer',
    docTypes.length > 0 &&
      docTypes.every((d) => d.LSHandlerRank === 'Alternate' && d.CFBundleTypeRole === 'Viewer'),
    docTypes.map((d) => `${String(d.LSHandlerRank)}/${String(d.CFBundleTypeRole)}`).join(', '),
  )
  const usage = Object.entries(plist).filter(([k]) => /^NS.*UsageDescription$/.test(k))
  // Electron's defaults start with "This app…" and never name RecoltOS.
  const defaults = usage.filter(
    ([, v]) => !/RecoltOS/.test(String(v)) || /\bThis app\b/i.test(String(v)),
  )
  add(
    'Info.plist: permission texts overridden (no Electron defaults)',
    defaults.length === 0,
    defaults.length ? defaults.map(([k]) => k).join(', ') : `${usage.length} texts`,
  )
  const frStrings = join(app, 'Contents', 'Resources', 'fr.lproj', 'InfoPlist.strings')
  add(
    'fr.lproj/InfoPlist.strings: French permission texts present',
    existsSync(frStrings),
    existsSync(frStrings) ? 'present' : 'missing',
  )

  // Signature.
  const verify = sh('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
  add('codesign --verify --deep --strict', verify.ok, verify.ok ? 'valid' : verify.out.trim())
  const appSign = signInfo(app)
  const hostSign = signInfo(host)
  if (identity) {
    add(
      `identity "${identity}" (app)`,
      appSign.authority === identity,
      appSign.authority ?? 'ad hoc',
    )
    add(
      `identity "${identity}" (native host)`,
      hostSign.authority === identity,
      hostSign.authority ?? 'ad hoc',
    )
    const dr = spawnSyncStderr('codesign', ['-d', '-r-', app])
    const line = /designated => (.+)/.exec(dr)?.[1]?.trim() ?? dr.trim()
    add(
      'stable designated requirement (certificate, not cdhash)',
      /^identifier "com\.recoltos\.app" and /.test(line) &&
        /\bcertificate leaf(?: = H"[0-9a-f]+"|\[)/i.test(line) &&
        !/\bcdhash\b/.test(line),
      line,
    )
  } else {
    add(
      'signature (no identity requested)',
      true,
      `app: ${appSign.authority ?? 'ad hoc'}, host: ${hostSign.authority ?? 'ad hoc'} — dev only`,
      appSign.adhoc,
    )
  }
  const hostVerify = sh('codesign', ['--verify', '--strict', host])
  add('native host signed', hostVerify.ok, hostVerify.ok ? 'valid' : hostVerify.out.trim())

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
      `fuse ${name} ${on ? 'enabled' : 'disabled'}`,
      state === want,
      state === FuseState.ENABLE
        ? 'enabled'
        : state === FuseState.DISABLE
          ? 'disabled'
          : 'inherited',
    )
  }

  // Native host.
  const hostMode = existsSync(host) ? statSync(host).mode : 0
  add('native host executable', (hostMode & 0o111) !== 0, host)
  const ping = existsSync(host) ? await hostPing(host) : { ok: false, detail: 'missing' }
  add('native host standalone', ping.ok, ping.detail)

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
      v ?? 'missing',
    )
    const scripts = walkFiles(dir).filter((f) => f.endsWith('.js'))
    const withImport = scripts.filter((f) => /^\s*import\s/m.test(readFileSync(f, 'utf8')))
    add(
      `extension ${target}: scripts without imports`,
      scripts.length > 0 && withImport.length === 0,
      withImport.map((f) => relative(dir, f)).join(', ') || `${scripts.length} scripts`,
    )
    const testCode = scripts.filter((f) =>
      /selfTest|testEndpoints|127\.0\.0\.1/.test(readFileSync(f, 'utf8')),
    )
    add(
      `extension ${target}: no test code`,
      testCode.length === 0,
      testCode.map((f) => relative(dir, f)).join(', ') || 'none',
    )
  }

  // app.asar.
  const asarPath = join(R, 'app.asar')
  const asar = readAsar(asarPath)
  const machO = asar.files.filter((f) => /\.(node|dylib)$|(^|\/)(ffmpeg|ffprobe)$/.test(f))
  add('app.asar: no Mach-O', machO.length === 0, machO.join(', ') || `${asar.files.length} files`)
  const maps = asar.files.filter((f) => /\.map$|\.onnx$|(^|\/)models\//.test(f))
  add('app.asar: no .map / .onnx', maps.length === 0, maps.slice(0, 5).join(', ') || 'none')
  const preload = asar.read('out/preload/index.js')
  const foreign = preload ? foreignRequires(preload.toString('utf8')) : ['(missing)']
  add('preload standalone', foreign.length === 0, foreign.join(', ') || 'electron + Node only')
  const leftovers = [...asar.files, ...asar.unpacked].filter((f) =>
    /(^|\/)node_modules\/(node-addon-api|[^/]+\/(src|install|deps))\//.test(f),
  )
  add(
    'app.asar: no native sources or build tooling',
    leftovers.length === 0,
    leftovers.slice(0, 5).join(', ') || 'none',
  )

  // Other platforms and sourcemaps across the whole bundle (excluding the Electron framework).
  const resources = walkFiles(R)
  const foreignBins = resources.filter((f) =>
    /(linux|linuxmusl|win32|darwin-x64|freebsd|wasm32)[^/]*\.(node|dll|so|dylib)$|sharp-(linux|win32|darwin-x64)/.test(
      f,
    ),
  )
  add(
    'no binary for another platform',
    foreignBins.length === 0,
    foreignBins.map((f) => relative(R, f)).join(', ') || 'none',
  )
  const resourceMaps = resources.filter((f) => f.endsWith('.map'))
  add(
    'no .map in Resources',
    resourceMaps.length === 0,
    resourceMaps.map((f) => relative(R, f)).join(', ') || 'none',
  )

  // Sizes.
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
    add(`size ${k} <= ${budget} MB`, v <= budget, `${v} MB`)
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
    const mark = !c.ok ? 'FAIL' : c.warn ? 'warn' : 'ok'
    console.log(`${mark.padEnd(6)} ${c.name} — ${c.detail}`)
  }
  console.log(
    `sizes (MB): ${Object.entries(report.sizesMb)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
  )
  const out = values.json ?? join(resolve(values.app, '..', '..'), 'check-dist.json')
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(report.ok ? 'check:dist: pass' : 'check:dist: FAILED')
  process.exit(report.ok ? 0 : 1)
}
