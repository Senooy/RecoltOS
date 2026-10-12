# Building the RecoltOS Firefox extension from source

## Build environment

The submitted extension was built on macOS (Apple Silicon) using Node.js 22.22.3 and pnpm 12.6.0.
The repository pins dependency versions in `package.json` and `pnpm-lock.yaml`. The included
`pnpm-workspace.yaml` selects the macOS arm64 native build tools.

The source archive includes `extension/`, `src/shared/`, `scripts/build-ext.mts`, the TypeScript
configuration, dependency manifests, lockfile, license and this document. It contains no
`node_modules`, API credentials, environment files or generated extension code.

## Commands

Install Node.js 22.22.3, extract the source archive and open a terminal in its root folder. If pnpm
12.6.0 is not installed, install it with `npm install --global pnpm@12.6.0`. Then run:

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build:ext
pnpm run lint:ext
```

`--ignore-scripts` skips the desktop Electron download and Git hooks; they are not needed to build
the extension. The platform-specific esbuild executable is installed as a dependency.

The Firefox output is `dist-extension/firefox/`. The same command also creates
`dist-extension/chromium/`. The submitted Firefox package consists of the files inside the Firefox
output directory, with `manifest.json` at the archive root.

The script bundles TypeScript with esbuild into self-contained JavaScript. It also writes the
Manifest V3 manifest and locale files and copies the included `extension/icons/16.png`, `32.png`,
`48.png` and `128.png` unchanged. The extension version and public Firefox ID are defined in
`src/shared/bridge/constants.ts`.

Do not supply `--test-base` or `--selftest`: those switches create a test-only build and are not used
for the submitted extension. No API keys or account credentials are needed to reproduce the build.
