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
    binaries?: string[]
    signIgnore?: string[]
  }
}

/** Reloads the config with a given environment (it reads `process.env` at evaluation). */
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
  it('sets the app identity and the arm64 "dir" target', () => {
    const c = loadConfig()
    expect(c.appId).toBe('com.recoltos.app')
    expect(c.productName).toBe('RecoltOS')
    expect(c.directories).toMatchObject({ buildResources: 'build', output: 'dist' })
    expect(c.mac.target).toEqual([{ target: 'dir', arch: ['arm64'] }])
    expect(c.mac.icon).toBe('build/icon.icns')
    expect(c.publish).toBeNull()
  })

  it("signs ad hoc ('-') without RECOLTOS_SIGN_IDENTITY, never with a null identity", () => {
    expect(loadConfig({ RECOLTOS_SIGN_IDENTITY: undefined }).mac.identity).toBe('-')
    expect(loadConfig({ RECOLTOS_SIGN_IDENTITY: '' }).mac.identity).toBe('-')
  })

  describe('explicit signing identity', () => {
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

    it('uses the supplied identity when the keychain contains it', () => {
      const bin = fakeSecurity(listing('RecoltOS Local'))
      expect(
        loadConfig({ RECOLTOS_SIGN_IDENTITY: 'RecoltOS Local', RECOLTOS_SECURITY_BIN: bin }).mac
          .identity,
      ).toBe('RecoltOS Local')
    })

    it('fails (instead of a silent ad hoc build) if the identity is missing from the keychain', () => {
      const bin = fakeSecurity('     0 valid identities found')
      expect(() =>
        loadConfig({ RECOLTOS_SIGN_IDENTITY: 'RecoltOS Local', RECOLTOS_SECURITY_BIN: bin }),
      ).toThrow(/RECOLTOS_SIGN_IDENTITY="RecoltOS Local".*docs\/signature\.md/s)
    })

    it('fails if only another identity exists, or if `security` fails', () => {
      const other = fakeSecurity(listing('Autre identité'))
      expect(() =>
        loadConfig({ RECOLTOS_SIGN_IDENTITY: 'RecoltOS Local', RECOLTOS_SECURITY_BIN: other }),
      ).toThrow(/no valid signing identity/)
      const broken = fakeSecurity('', 1)
      expect(() =>
        loadConfig({ RECOLTOS_SIGN_IDENTITY: 'RecoltOS Local', RECOLTOS_SECURITY_BIN: broken }),
      ).toThrow(/no valid signing identity/)
    })
  })

  it('leaves the native host signed by build:host (no Electron JIT entitlements)', () => {
    const c = loadConfig()
    expect(c.mac.binaries).toBeUndefined()
    const ignore = (c.mac.signIgnore ?? []).map((r) => new RegExp(r))
    const host = '/x/RecoltOS.app/Contents/Resources/native-host/recolt-host'
    expect(ignore.some((r) => r.test(host))).toBe(true)
    expect(ignore.some((r) => r.test('/x/RecoltOS.app/Contents/MacOS/RecoltOS'))).toBe(false)
  })

  it('does not rebuild natives and moves natives out of app.asar', () => {
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

  it('does not bundle ffmpeg, a model, or onnxruntime', () => {
    const c = loadConfig()
    const text = JSON.stringify(c)
    expect(text).not.toMatch(/ffmpeg|ffprobe|onnx|\.bin-cache/i)
    for (const entry of c.extraResources) {
      expect(entry.to).not.toMatch(/^bin(\/|$)/)
    }
  })

  it('excludes the non-darwin-arm64 better-sqlite3 prebuilds and the bundle host', () => {
    const { files } = loadConfig()
    expect(files).toContain(
      '!node_modules/better-sqlite3/prebuilds/{linux*,win32*,darwin-x64}.node',
    )
    expect(files).toContain('!out/host/**')
    expect(files).toContain('!**/*.map')
  })

  it('closes runAsNode and CLI inspection in the shipped build, opens them for the test profile', () => {
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

  it('outputs the test profile to dist/test/ (the shipped build is never replaced)', () => {
    expect(loadConfig({ RECOLTOS_DIST_PROFILE: undefined }).directories.output).toBe('dist')
    expect(loadConfig({ RECOLTOS_DIST_PROFILE: 'test' }).directories.output).toBe('dist/test')
  })

  it('excludes the native build tooling and other platforms', () => {
    const files = loadConfig().files
    for (const p of [
      '!node_modules/node-addon-api/**',
      '!node_modules/sharp/{src,install}/**',
      '!node_modules/better-sqlite3/lib/{linux*,win32*,darwin-x64}.js',
      '!out/.build-hash',
    ])
      expect(files).toContain(p)
  })

  it('permission texts in French', () => {
    const info = loadConfig().mac.extendInfo
    for (const [key, value] of Object.entries(info)) {
      if (key.endsWith('UsageDescription')) expect(value).not.toMatch(/This app/)
    }
  })
})

describe('RecoltOS icon', () => {
  it('build/icon.png is a 1024×1024 PNG and icon.icns a valid ICNS', () => {
    const png = readFileSync(resolve(root, 'build', 'icon.png'))
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(1024)
    expect(png.readUInt32BE(20)).toBe(1024)
    const icns = readFileSync(resolve(root, 'build', 'icon.icns'))
    expect(icns.subarray(0, 4).toString('ascii')).toBe('icns')
    expect(icns.readUInt32BE(4)).toBe(icns.length)
  })

  it('package scripts: no reference to another app', () => {
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

describe('shell scripts', () => {
  it.each(['scripts/install-local.sh', 'scripts/make-icns.sh'])('%s: valid sh syntax', (rel) => {
    const file = resolve(root, rel)
    expect(existsSync(file)).toBe(true)
    expect(statSync(file).mode & 0o111).not.toBe(0)
    expect(() => execFileSync('sh', ['-n', file])).not.toThrow()
  })

  it('install-local.sh cleanly refuses when the build is missing', () => {
    const tmp = resolve(root, '.tmp', 'install-local-test')
    let status = 0
    let stderr = ''
    try {
      // Working folder without dist/: we copy the script into a fake repo.
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
