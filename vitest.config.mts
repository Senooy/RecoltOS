/**
 * Vitest (QA §5.1) : trois projets.
 *  - `unit`     : Node, processus enfants (`forks`), `tests/unit/**`, `src/**` et les auto-tests de l'outillage.
 *  - `renderer` : happy-dom, `tests/renderer/**`.
 *  - `real`     : `tests/real/**`, séquentiel, ignoré sauf si `RECOLTOS_REAL_LIBRARY` est défini.
 * Les alias répliquent ceux d'`electron.vite.config.ts` / `tsconfig.base.json`.
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
          setupFiles: ['tests/setup/node.ts'],
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
        },
      },
      {
        extends: true,
        test: {
          name: 'real',
          environment: 'node',
          pool: 'forks',
          include: realLibrary ? ['tests/real/**/*.test.ts'] : [],
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
