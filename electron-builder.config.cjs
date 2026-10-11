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
  mac: {
    target: [{ target: 'dir', arch: ['arm64'] }],
    category: 'public.app-category.graphics-design',
    icon: 'build/icon.icns',
    identity: process.env.RECOLTOS_SIGN_IDENTITY || '-',
    hardenedRuntime: false,
    gatekeeperAssess: false,
    notarize: false,
    darkModeSupport: true,
    extendInfo: {
      LSMinimumSystemVersion: '13.0',
      NSDesktopFolderUsageDescription: 'RecoltOS surveille le dossier de dépôt des captures.',
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
