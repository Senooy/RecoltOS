/**
 * Playwright `build` project: builds `out/` if the sources have changed since the last
 * build (see `tests/helpers/ensure-build.ts`).
 */
import { test as setup } from '@playwright/test'
import { ensureBuild } from '../helpers/ensure-build'

setup('build: out/ up to date', () => {
  setup.setTimeout(300_000)
  ensureBuild()
})
