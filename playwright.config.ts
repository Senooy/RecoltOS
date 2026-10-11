/**
 * Playwright (QA §6.1) : Electron seul (`_electron`), pas de `playwright install` pour e2e / visual /
 * perf / packaged. Projets : `build` (auto, dépendance des trois premiers), `e2e`, `visual`, `perf`,
 * `packaged`, `ext-smoke` (opt-in : Chromium de Playwright).
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests',
  tsconfig: './tsconfig.tests.json',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  outputDir: 'test-results',
  snapshotPathTemplate: '{testDir}/{testFileDir}/__snapshots__/{arg}{ext}',
  forbidOnly: !!process.env.CI,
  use: { trace: 'retain-on-failure' },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  projects: [
    { name: 'build', testDir: 'tests/setup', testMatch: /ensure-build\.setup\.ts$/ },
    {
      name: 'e2e',
      testDir: 'tests',
      // `tests/setup/launch.smoke.spec.ts` : fumée du lot outillage (WP-01) ; les scénarios des lots
      // vivent sous `tests/e2e/`.
      testMatch: [/e2e\/.*\.spec\.ts$/, /setup\/launch\.smoke\.spec\.ts$/],
      dependencies: ['build'],
    },
    {
      name: 'visual',
      testDir: 'tests',
      // `tests/setup/geometry.smoke.spec.ts` : géométrie du squelette (WP-01) ; les scènes des lots
      // vivent sous `tests/visual/`.
      testMatch: [/visual\/.*\.spec\.ts$/, /setup\/geometry\.smoke\.spec\.ts$/],
      dependencies: ['build'],
    },
    {
      name: 'perf',
      testDir: 'tests/perf',
      testMatch: /.*\.spec\.ts$/,
      timeout: 180_000,
      dependencies: ['build'],
    },
    { name: 'packaged', testDir: 'tests/packaged', testMatch: /.*\.spec\.ts$/ },
    { name: 'ext-smoke', testDir: 'tests/ext', testMatch: /.*\.spec\.ts$/ },
  ],
})
