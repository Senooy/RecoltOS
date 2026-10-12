/**
 * Vitest: three projects.
 *  - `unit`     : Node, child processes (`forks`), `tests/unit/**`, `src/**` and the tooling self-tests.
 *  - `renderer` : happy-dom, `tests/renderer/**`.
 *  - `real`     : `tests/real/**`, sequential, skipped unless `RECOLTOS_REAL_LIBRARY` is set
 *                 (or `RECOLT_TEST_IMPORTED_USERDATA`: only `m2-imported` and `m3-imported`).
 * The aliases mirror those of `electron.vite.config.ts` / `tsconfig.base.json`.
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))
const alias = {
  '@shared': `${root}src/shared`,
  '@main': `${root}src/main`,
  '@renderer': `${root}src/renderer/src`,
}

const realLibrary = process.env.RECOLTOS_REAL_LIBRARY
/** RecoltOS library already imported (dev copy, e.g. `.tmp/m2-real`): M2 tests on real data. */
const importedUserData = process.env.RECOLT_TEST_IMPORTED_USERDATA

export default defineConfig({
  resolve: { alias },
  test: {
    passWithNoTests: true,
    exclude: ['**/node_modules/**', '.worktrees/**', '.tmp/**', 'out/**', 'dist/**'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          pool: 'forks',
          include: [
            'tests/unit/**/*.test.ts',
            'tests/helpers/**/*.test.ts',
            'tests/setup/**/*.test.ts',
            'src/**/*.test.ts',
          ],
          testTimeout: 20_000,
          env: { TZ: 'UTC' },
          setupFiles: ['tests/setup/node.ts', 'tests/setup/lang.ts'],
          globalSetup: ['tests/setup/global-host.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          environment: 'happy-dom',
          include: ['tests/renderer/**/*.test.{ts,tsx}'],
          testTimeout: 20_000,
          env: { TZ: 'UTC' },
          setupFiles: ['tests/setup/lang.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'real',
          environment: 'node',
          pool: 'forks',
          include: realLibrary
            ? ['tests/real/**/*.test.ts']
            : importedUserData
              ? [
                  'tests/real/m2-imported.test.ts',
                  'tests/real/m3-imported.test.ts',
                  'tests/real/m4-imported.test.ts',
                ]
              : [],
          fileParallelism: false,
          testTimeout: 600_000,
          hookTimeout: 600_000,
          setupFiles: ['tests/setup/node.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/main/{db,import,importers,ingest,sync,ai}/**', 'src/host/**', 'src/shared/**'],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
    },
  },
})
