/**
 * Playwright: Electron only (`_electron`), no `playwright install` for e2e / visual /
 * perf / packaged. Projects: `build` (auto, dependency of the first three), `e2e`, `visual`, `perf`,
 * `packaged`, `ext-smoke` (opt-in: Playwright's Chromium).
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
      // `tests/setup/*.spec.ts`: tooling smoke tests; the scenarios live under `tests/e2e/`.
      testMatch: [
        /e2e\/.*\.spec\.ts$/,
        /setup\/launch\.smoke\.spec\.ts$/,
        /setup\/console-capture\.spec\.ts$/,
        /setup\/demo-fixture\.spec\.ts$/,
      ],
      dependencies: ['build'],
    },
    {
      name: 'visual',
      testDir: 'tests',
      // Internal visual regression: baselines under `tests/visual/__snapshots__/` (fake data).
      testMatch: /visual\/.*\.spec\.ts$/,
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
    {
      name: 'ext-smoke',
      testDir: 'tests/ext',
      testMatch: /.*\.spec\.ts$/,
      dependencies: ['build'],
    },
  ],
})
