/**
 * Projet Playwright `build` : construit `out/` si les sources ont changé depuis le
 * dernier build (voir `tests/helpers/ensure-build.ts`).
 */
import { test as setup } from '@playwright/test'
import { ensureBuild } from '../helpers/ensure-build'

setup('build : out/ à jour', () => {
  setup.setTimeout(300_000)
  ensureBuild()
})
