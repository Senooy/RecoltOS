/**
 * Configuration electron-builder (QA §8.1 réduit au minimum utile dès M0 ; WP-72 la finalise :
 * fuses du build livré, `fileAssociations`, `check-dist`, budgets de taille).
 *
 * - arm64 uniquement, cible `dir` : `dist/mac-arm64/RecoltOS.app` (pas de dmg/zip, pas de mise à jour).
 * - Identité de signature : `RECOLTOS_SIGN_IDENTITY` (certificat local « RecoltOS Local », voir
 *   `docs/signature.md`), sinon `'-'` = signature ad hoc explicite (dev seulement). `identity: null`
 *   est piégé : sur arm64 il ne laisse que la signature du linker, refusée au lancement.
 * - Binaires ffmpeg / ffprobe : système, jamais embarqués (PLAN §1.16). Pas de modèle ni d'onnxruntime
 *   (recherche visuelle retirée de la V1, ERRATA §G).
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = __dirname

/**
 * Hôte natif de l'extension (exécutable Node SEA séparé, ERRATA §D) : produit par `build:host`
 * (WP-52) dans `out/native-host/`. Réservé ici : copié vers `Contents/Resources/native-host/` dès
 * qu'il existe, sans casser le build tant que le lot hôte n'est pas livré.
 */
const nativeHost = fs.existsSync(path.join(root, 'out', 'native-host'))
  ? [{ from: 'out/native-host', to: 'native-host' }]
  : []

/** Extension navigateur buildée (`build:ext` → `dist-extension/`), embarquée si présente. */
const extension = fs.existsSync(path.join(root, 'dist-extension'))
  ? [{ from: 'dist-extension', to: 'extension' }]
  : []

/**
 * Identité de signature demandée. electron-builder 26 ne bloque pas si l'identité nommée est absente ou
 * non approuvée du trousseau : il logue « skipped macOS application code signing », sort avec 0 et produit
 * un .app en signature ad hoc (cdhash instable, permissions TCC perdues). On échoue donc ici, tôt et
 * clairement.
 *
 * Correspondance : seul le nom exact du certificat ou son hash complet (40 hex) est accepté. electron-builder
 * accepte une sous-chaîne ; on est volontairement plus strict pour ne jamais signer avec une identité proche
 * de celle demandée.
 *
 * `RECOLTOS_SECURITY_BIN` remplace `security`, et seulement sous Vitest ou NODE_ENV=test : ce hook de test
 * ne doit pas être actif dans un build de production.
 */
const testHooksEnabled = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST)

function resolveSignIdentity() {
  const identity = (process.env.RECOLTOS_SIGN_IDENTITY || '').trim()
  if (identity === '') return '-'
  if (identity === '-') return '-'
  const securityBin = (testHooksEnabled && process.env.RECOLTOS_SECURITY_BIN) || 'security'
  if (process.platform !== 'darwin' && !(testHooksEnabled && process.env.RECOLTOS_SECURITY_BIN))
    return identity
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
  const found = names.some(([, hash, name]) => name === identity || hash === identity.toUpperCase())
  if (!found) {
    throw new Error(
      `RECOLTOS_SIGN_IDENTITY="${identity}" : aucune identité de signature valide de ce nom dans le trousseau ` +
        '(vérifie `security find-identity -v -p codesigning` ; le certificat doit être approuvé pour la signature ' +
        'de code, voir docs/signature.md). Retire la variable pour une signature ad hoc.',
    )
  }
  return identity
}

/**
 * Profils de fuses : `RECOLTOS_DIST_PROFILE=test` (réservé aux tests Playwright de l'app empaquetée)
 * laisse `runAsNode` et l'inspection CLI ouverts ; le build livré les ferme (ERRATA §D).
 */
const testProfile = process.env.RECOLTOS_DIST_PROFILE === 'test'

module.exports = {
  appId: 'com.recoltos.app',
  productName: 'RecoltOS',
  copyright: 'Copyright © 2026 RecoltOS',
  directories: { buildResources: 'build', output: 'dist' },
  artifactName: '${productName}-${version}-${arch}.${ext}',
  asar: true,
  // Les natifs (better-sqlite3 : prebuild N-API ; sharp : @img/*) sont préconstruits : aucun rebuild.
  npmRebuild: false,
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  removePackageScripts: true,
  publish: null,
  electronLanguages: ['fr', 'en'],
  // Fuses : option intégrée d'electron-builder (clés camelCase), aucun hook after-pack.
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
    '!**/*.map',
    '!node_modules/**/{test,tests,__tests__,docs,example,examples}/**',
    '!node_modules/better-sqlite3/{deps,src}/**',
    '!node_modules/better-sqlite3/prebuilds/{linux*,win32*,darwin-x64}.node',
  ],
  asarUnpack: [
    '**/*.node',
    '**/node_modules/better-sqlite3/prebuilds/**',
    '**/node_modules/sharp/**',
    '**/node_modules/@img/**',
  ],
  extraResources: [...nativeHost, ...extension],
  // « Ouvrir avec RecoltOS » (SPACES §3.3, WP-34) : `Alternate` = présent dans « Ouvrir avec » sans
  // devenir l'app par défaut ; `Viewer` explicite (le défaut est `Editor`).
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
    identity: resolveSignIdentity(),
    hardenedRuntime: false,
    gatekeeperAssess: false,
    notarize: false,
    darkModeSupport: true,
    extendInfo: {
      LSMinimumSystemVersion: '13.0',
      NSDesktopFolderUsageDescription:
        'RecoltOS enregistre tes captures dans ce dossier si tu l’as choisi.',
      NSDocumentsFolderUsageDescription: 'RecoltOS importe les fichiers que tu lui confies.',
      NSDownloadsFolderUsageDescription: 'RecoltOS importe les fichiers que tu lui confies.',
      // Remplace les textes anglais par défaut d'Electron : aucun texte anglais visible (PLAN §2.6).
      NSCameraUsageDescription: "RecoltOS n'utilise pas la caméra.",
      NSMicrophoneUsageDescription: "RecoltOS n'utilise pas le micro.",
      NSAudioCaptureUsageDescription: "RecoltOS n'enregistre pas le son.",
      NSBluetoothAlwaysUsageDescription: "RecoltOS n'utilise pas le Bluetooth.",
      NSBluetoothPeripheralUsageDescription: "RecoltOS n'utilise pas le Bluetooth.",
    },
  },
}
