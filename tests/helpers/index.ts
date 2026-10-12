/**
 * Entry point of the test helpers. Importable from vitest AND from Playwright (which
 * loads test files as CJS): no `import.meta` here nor in the re-exported modules.
 */
import { join } from 'node:path'
import { REPO_ROOT } from './paths'

export * from './clock'
export * from './db'
export * from './demo-library'
export * from './paths'
export * from './remote-server'
export * from './synthetic-items'
export * from './synthetic-media'
export * from './tmpdir'

/** Fake binaries (`claude`, `codex`, `ffmpeg`…) to put at the head of the tests' `PATH`. */
export const FAKE_BIN_DIR = join(REPO_ROOT, 'tests/helpers/fake-bin')
