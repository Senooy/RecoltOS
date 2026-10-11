import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
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

  it("utilise l'identité fournie par RECOLTOS_SIGN_IDENTITY", () => {
    expect(loadConfig({ RECOLTOS_SIGN_IDENTITY: 'RecoltOS Local' }).mac.identity).toBe(
      'RecoltOS Local',
    )
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

  it("n'embarque ni ffmpeg, ni modèle, ni onnxruntime (PLAN §1.16, ERRATA §G)", () => {
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

  it('ne contient aucune référence à la référence dans les scripts et assets du lot', () => {
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
