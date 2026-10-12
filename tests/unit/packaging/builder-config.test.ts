import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..', '..', '..')
const require_ = createRequire(import.meta.url)
const CONFIG = resolve(root, 'electron-builder.config.cjs')

interface BuilderConfig {
  appId: string
  productName: string
  directories: { buildResources: string; output: string }
  publish: unknown
  npmRebuild: boolean
  asarUnpack: string[]
  files: string[]
  extraResources: Array<{ from: string; to: string }>
  electronFuses: Record<string, boolean>
  mac: {
    target: unknown
    icon: string
    identity: string
    extendInfo: Record<string, string>
  }
}

/** Recharge la config avec un environnement donné (elle lit `process.env` à l'évaluation). */
function loadConfig(env: Record<string, string | undefined> = {}): BuilderConfig {
  const saved: Record<string, string | undefined> = {}
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key]
    if (env[key] === undefined) delete process.env[key]
    else process.env[key] = env[key]
  }
  delete require_.cache[CONFIG]
  try {
    return require_(CONFIG) as BuilderConfig
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    delete require_.cache[CONFIG]
  }
}

afterEach(() => {
  delete require_.cache[CONFIG]
})

describe('electron-builder.config.cjs', () => {
  it("fixe l'identité de l'app et la cible arm64 « dir »", () => {
    const c = loadConfig()
    expect(c.appId).toBe('com.recoltos.app')
    expect(c.productName).toBe('RecoltOS')
    expect(c.directories).toMatchObject({ buildResources: 'build', output: 'dist' })
    expect(c.mac.target).toEqual([{ target: 'dir', arch: ['arm64'] }])
    expect(c.mac.icon).toBe('build/icon.icns')
    expect(c.publish).toBeNull()
  })

  it("signe en ad hoc ('-') sans RECOLTOS_SIGN_IDENTITY, jamais avec une identité nulle", () => {
    expect(loadConfig({ RECOLTOS_SIGN_IDENTITY: undefined }).mac.identity).toBe('-')
    expect(loadConfig({ RECOLTOS_SIGN_IDENTITY: '' }).mac.identity).toBe('-')
  })

  describe('identité de signature explicite', () => {
    let dir = ''
    const fakeSecurity = (output: string, exit = 0): string => {
      dir = mkdtempSync(join(tmpdir(), 'recoltos-sec-'))
      const bin = join(dir, 'security')
      writeFileSync(bin, `#!/bin/sh\ncat <<'EOF'\n${output}\nEOF\nexit ${exit}\n`, { mode: 0o755 })
      return bin
    }
    const listing = (name: string): string =>
      `  1) ${'A'.repeat(40)} "${name}"\n     1 valid identities found`

    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true })
      dir = ''
    })

    it("utilise l'identité fournie quand le trousseau la contient", () => {
      const bin = fakeSecurity(listing('RecoltOS Local'))
      expect(
        loadConfig({ RECOLTOS_SIGN_IDENTITY: 'RecoltOS Local', RECOLTOS_SECURITY_BIN: bin }).mac
          .identity,
      ).toBe('RecoltOS Local')
    })

    it("échoue (au lieu d'un build ad hoc silencieux) si l'identité est absente du trousseau", () => {
      const bin = fakeSecurity('     0 valid identities found')
      expect(() =>
        loadConfig({ RECOLTOS_SIGN_IDENTITY: 'RecoltOS Local', RECOLTOS_SECURITY_BIN: bin }),
      ).toThrow(/RECOLTOS_SIGN_IDENTITY="RecoltOS Local".*docs\/signature\.md/s)
    })

    it('échoue si seule une autre identité existe, ou si `security` échoue', () => {
      const other = fakeSecurity(listing('Autre identité'))
      expect(() =>
        loadConfig({ RECOLTOS_SIGN_IDENTITY: 'RecoltOS Local', RECOLTOS_SECURITY_BIN: other }),
      ).toThrow(/aucune identité de signature valide/)
      const broken = fakeSecurity('', 1)
      expect(() =>
        loadConfig({ RECOLTOS_SIGN_IDENTITY: 'RecoltOS Local', RECOLTOS_SECURITY_BIN: broken }),
      ).toThrow(/aucune identité de signature valide/)
    })
  })

  it('ne rebuild pas les natifs et sort les natifs de app.asar', () => {
    const c = loadConfig()
    expect(c.npmRebuild).toBe(false)
    expect(c.asarUnpack).toEqual(
      expect.arrayContaining([
        '**/*.node',
        '**/node_modules/better-sqlite3/prebuilds/**',
        '**/node_modules/sharp/**',
        '**/node_modules/@img/**',
      ]),
    )
  })

  it("n'embarque ni ffmpeg, ni modèle, ni onnxruntime", () => {
    const c = loadConfig()
    const text = JSON.stringify(c)
    expect(text).not.toMatch(/ffmpeg|ffprobe|onnx|\.bin-cache/i)
    for (const entry of c.extraResources) {
      expect(entry.to).not.toMatch(/^bin(\/|$)/)
    }
  })

  it("exclut les prébuilds non darwin-arm64 de better-sqlite3 et l'hôte du bundle", () => {
    const { files } = loadConfig()
    expect(files).toContain(
      '!node_modules/better-sqlite3/prebuilds/{linux*,win32*,darwin-x64}.node',
    )
    expect(files).toContain('!out/host/**')
    expect(files).toContain('!**/*.map')
  })

  it('ferme runAsNode et l’inspection CLI dans le build livré, les ouvre au profil test', () => {
    const shipped = loadConfig({ RECOLTOS_DIST_PROFILE: undefined }).electronFuses
    expect(shipped).toMatchObject({
      runAsNode: false,
      enableNodeCliInspectArguments: false,
      enableNodeOptionsEnvironmentVariable: false,
      onlyLoadAppFromAsar: true,
    })
    const test = loadConfig({ RECOLTOS_DIST_PROFILE: 'test' }).electronFuses
    expect(test).toMatchObject({ runAsNode: true, enableNodeCliInspectArguments: true })
  })

  it('sort le profil test dans dist/test/ (le build livré n’est jamais remplacé)', () => {
    expect(loadConfig({ RECOLTOS_DIST_PROFILE: undefined }).directories.output).toBe('dist')
    expect(loadConfig({ RECOLTOS_DIST_PROFILE: 'test' }).directories.output).toBe('dist/test')
  })

  it('exclut l’outillage de build natif et les autres plateformes', () => {
    const files = loadConfig().files
    for (const p of [
      '!node_modules/node-addon-api/**',
      '!node_modules/sharp/{src,install}/**',
      '!node_modules/better-sqlite3/lib/{linux*,win32*,darwin-x64}.js',
      '!out/.build-hash',
    ])
      expect(files).toContain(p)
  })

  it('texte des permissions en français', () => {
    const info = loadConfig().mac.extendInfo
    for (const [key, value] of Object.entries(info)) {
      if (key.endsWith('UsageDescription')) expect(value).not.toMatch(/This app/)
    }
  })
})

describe('icône RecoltOS', () => {
  it('build/icon.png est un PNG 1024×1024 et icon.icns un ICNS valide', () => {
    const png = readFileSync(resolve(root, 'build', 'icon.png'))
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(1024)
    expect(png.readUInt32BE(20)).toBe(1024)
    const icns = readFileSync(resolve(root, 'build', 'icon.icns'))
    expect(icns.subarray(0, 4).toString('ascii')).toBe('icns')
    expect(icns.readUInt32BE(4)).toBe(icns.length)
  })

  it('scripts de paquet : aucune référence à une autre app', () => {
    for (const rel of [
      'electron-builder.config.cjs',
      'scripts/make-icon.mts',
      'scripts/make-icns.sh',
      'scripts/install-local.sh',
    ]) {
      const text = readFileSync(resolve(root, rel), 'utf8')
      expect(text, rel).not.toMatch(/gather/i)
    }
  })
})

describe('scripts shell', () => {
  it.each(['scripts/install-local.sh', 'scripts/make-icns.sh'])('%s : syntaxe sh valide', (rel) => {
    const file = resolve(root, rel)
    expect(existsSync(file)).toBe(true)
    expect(statSync(file).mode & 0o111).not.toBe(0)
    expect(() => execFileSync('sh', ['-n', file])).not.toThrow()
  })

  it('install-local.sh refuse proprement quand le build est absent', () => {
    const tmp = resolve(root, '.tmp', 'install-local-test')
    let status = 0
    let stderr = ''
    try {
      // Dossier de travail sans dist/ : on copie le script dans un faux dépôt.
      execFileSync('sh', [
        '-c',
        `mkdir -p "${tmp}/scripts" && cp "${root}/scripts/install-local.sh" "${tmp}/scripts/"`,
      ])
      execFileSync('sh', [resolve(tmp, 'scripts', 'install-local.sh')], {
        env: { ...process.env, RECOLTOS_INSTALL_DIR: resolve(tmp, 'apps'), RECOLTOS_NO_OPEN: '1' },
        stdio: 'pipe',
      })
    } catch (error) {
      const e = error as { status: number; stderr: Buffer }
      status = e.status
      stderr = e.stderr.toString()
    }
    expect(status).toBe(1)
    expect(stderr).toContain('pnpm run dist')
    expect(existsSync(resolve(tmp, 'apps', 'RecoltOS.app'))).toBe(false)
  })
})
