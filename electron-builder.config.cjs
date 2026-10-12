/**
 * electron-builder configuration (shipped build fuses, `fileAssociations`, `check-dist`,
 * size budgets).
 *
 * - arm64 only, target `dir`: `dist/mac-arm64/RecoltOS.app`; disk image via `pnpm run dist:dmg` (no automatic update).
 * - Signing identity: `RECOLTOS_SIGN_IDENTITY` (local certificate "RecoltOS Local", see
 *   `docs/signature.md`), otherwise `'-'` = explicit ad hoc signature (dev only). `identity: null`
 *   is a trap: on arm64 it only leaves the linker signature, which is refused at launch.
 * - ffmpeg / ffprobe binaries: system-provided, never bundled. No model nor onnxruntime
 *   (visual search removed from V1).
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = __dirname

/**
 * Native host of the extension (separate Node SEA executable): produced by `build:host`
 * into `out/native-host/recolt-host`, copied alone to `Contents/Resources/native-host/`.
 */
const nativeHost = fs.existsSync(path.join(root, 'out', 'native-host', 'recolt-host'))
  ? [{ from: 'out/native-host', to: 'native-host', filter: ['recolt-host'] }]
  : []

/**
 * Built browser extension (`build:ext` → `dist-extension/{chromium,firefox}/`), and
 * the signed Firefox extension if `pnpm run sign:firefox` was run (`dist-extension/signed/*.xpi`).
 */
const extension = [
  ...(fs.existsSync(path.join(root, 'dist-extension', 'chromium'))
    ? [{ from: 'dist-extension', to: 'extension', filter: ['chromium/**', 'firefox/**'] }]
    : []),
  ...(fs.existsSync(path.join(root, 'dist-extension', 'signed'))
    ? [{ from: 'dist-extension/signed', to: 'extension', filter: ['*.xpi'] }]
    : []),
]

/**
 * Requested signing identity. electron-builder 26 does not block if the named identity is missing or
 * not trusted by the keychain: it logs "skipped macOS application code signing", exits with 0 and produces
 * an .app with an ad hoc signature (unstable cdhash, TCC permissions lost). So we fail here, early and
 * clearly.
 *
 * Matching: only the exact certificate name or its full hash (40 hex) is accepted. electron-builder
 * accepts a substring; we are deliberately stricter so we never sign with an identity close
 * to the requested one.
 *
 * `RECOLTOS_SECURITY_BIN` replaces `security`, and only under Vitest or NODE_ENV=test: this test hook
 * must not be active in a production build.
 */
const testHooksEnabled = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST)

function resolveSignIdentity() {
  const identity = (process.env.RECOLTOS_SIGN_IDENTITY || '').trim()
  if (identity === '' || identity === '-') return { identity: '-', developerId: false }
  const securityBin = (testHooksEnabled && process.env.RECOLTOS_SECURITY_BIN) || 'security'
  if (process.platform !== 'darwin' && !(testHooksEnabled && process.env.RECOLTOS_SECURITY_BIN))
    return { identity, developerId: identity.startsWith('Developer ID Application:') }
  let listing = ''
  try {
    listing = execFileSync(securityBin, ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    listing = ''
  }
  const names = [...listing.matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s+"([^"]*)"/gim)]
  const found = names.find(([, hash, name]) => name === identity || hash === identity.toUpperCase())
  if (!found) {
    throw new Error(
      `RECOLTOS_SIGN_IDENTITY="${identity}": no valid signing identity with this name in the keychain ` +
        '(check `security find-identity -v -p codesigning`; the certificate must be trusted for code signing, ' +
        'see docs/signature.md). Unset the variable for an ad hoc signature.',
    )
  }
  const developerId = found[2].startsWith('Developer ID Application:')
  // electron-builder rejects the Apple prefix in the name: the hash keeps an exact selection.
  return { identity: developerId ? found[1] : identity, developerId }
}

/**
 * Fuse profiles: `RECOLTOS_DIST_PROFILE=test` (`pnpm run dist:test`, reserved for Playwright tests
 * of the packaged app) leaves `runAsNode` and CLI inspection open and outputs to `dist/test/` so as
 * to never replace the shipped build; the shipped build (`dist/mac-arm64/`) closes them.
 * The native host is a separate SEA executable: it does not depend on `runAsNode`.
 */
const testProfile = process.env.RECOLTOS_DIST_PROFILE === 'test'
const signing = resolveSignIdentity()
const notarize = process.env.RECOLTOS_NOTARIZE === '1'
if (notarize && (!signing.developerId || testProfile || !process.env.APPLE_TEAM_ID?.trim())) {
  throw new Error(
    'Notarization requires a Developer ID Application identity, APPLE_TEAM_ID and the shipped profile.',
  )
}
const releaseHooks = require('./scripts/notarize.cjs')

module.exports = {
  appId: 'com.recoltos.app',
  productName: 'RecoltOS',
  copyright: 'Copyright © 2026 RecoltOS',
  directories: { buildResources: 'build', output: testProfile ? 'dist/test' : 'dist' },
  artifactName: '${productName}-${version}-${arch}.${ext}',
  asar: true,
  // Native modules (better-sqlite3: N-API prebuild; sharp: @img/*) are prebuilt: no rebuild.
  npmRebuild: false,
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  removePackageScripts: true,
  publish: null,
  forceCodeSigning: notarize,
  afterSign: releaseHooks.notarizeApp,
  afterAllArtifactBuild: releaseHooks.notarizeDmg,
  dmg: { sign: signing.developerId, writeUpdateInfo: false },
  electronLanguages: ['fr', 'en'],
  // Fuses: built-in electron-builder option (camelCase keys), no after-pack hook.
  electronFuses: {
    runAsNode: testProfile,
    enableNodeCliInspectArguments: testProfile,
    enableNodeOptionsEnvironmentVariable: false,
    onlyLoadAppFromAsar: true,
    enableEmbeddedAsarIntegrityValidation: false,
    resetAdHocDarwinSignature: true,
  },
  files: [
    'out/**',
    'resources/**',
    '!out/host/**',
    '!out/native-host/**',
    'package.json',
    '!out/.build-hash',
    '!**/*.map',
    '!node_modules/**/{test,tests,__tests__,docs,example,examples}/**',
    // nothing that only serves compilation (headers, gyp, native sources) nor other platforms.
    '!node_modules/**/{README,CHANGELOG,HISTORY,CONTRIBUTING}*',
    '!node_modules/**/*.{d.ts,d.mts,d.cts,gyp,gypi,h,hpp,cc,c}',
    '!node_modules/node-addon-api/**',
    '!node_modules/sharp/{src,install}/**',
    '!node_modules/better-sqlite3/{deps,src}/**',
    '!node_modules/better-sqlite3/prebuilds/{linux*,win32*,darwin-x64}.node',
    '!node_modules/better-sqlite3/lib/{linux*,win32*,darwin-x64}.js',
  ],
  asarUnpack: [
    '**/*.node',
    '**/node_modules/better-sqlite3/prebuilds/**',
    '**/node_modules/sharp/**',
    '**/node_modules/@img/**',
  ],
  extraResources: [...nativeHost, ...extension],
  // "Open with RecoltOS": `Alternate` = listed in "Open with" without
  // becoming the default app; explicit `Viewer` (the default is `Editor`).
  fileAssociations: [
    {
      ext: [
        'png',
        'jpg',
        'jpeg',
        'webp',
        'gif',
        'avif',
        'heic',
        'heif',
        'tif',
        'tiff',
        'bmp',
        'mp4',
        'mov',
        'm4v',
        'webm',
      ],
      name: 'Image ou vidéo',
      role: 'Viewer',
      rank: 'Alternate',
    },
  ],
  mac: {
    target: [{ target: 'dir', arch: ['arm64'] }],
    category: 'public.app-category.graphics-design',
    icon: 'build/icon.icns',
    identity: signing.identity,
    hardenedRuntime: signing.developerId,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    binaries: nativeHost.length ? ['Contents/Resources/native-host/recolt-host'] : [],
    gatekeeperAssess: false,
    notarize: false,
    darkModeSupport: true,
    extendInfo: {
      LSMinimumSystemVersion: '13.0',
      NSDesktopFolderUsageDescription:
        'RecoltOS enregistre tes captures dans ce dossier si tu l’as choisi.',
      NSDocumentsFolderUsageDescription: 'RecoltOS importe les fichiers que tu lui confies.',
      NSDownloadsFolderUsageDescription: 'RecoltOS importe les fichiers que tu lui confies.',
      // Replaces Electron's default English texts: no English text visible.
      NSCameraUsageDescription: "RecoltOS n'utilise pas la caméra.",
      NSMicrophoneUsageDescription: "RecoltOS n'utilise pas le micro.",
      NSAudioCaptureUsageDescription: "RecoltOS n'enregistre pas le son.",
      NSBluetoothAlwaysUsageDescription: "RecoltOS n'utilise pas le Bluetooth.",
      NSBluetoothPeripheralUsageDescription: "RecoltOS n'utilise pas le Bluetooth.",
    },
  },
}
