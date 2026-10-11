/**
 * Point d'entrée des helpers de test (QA §5.1). Importable depuis vitest ET depuis Playwright (qui
 * charge les fichiers de test en CJS) : aucun `import.meta` ici ni dans les modules réexportés.
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

/** Faux binaires (`claude`, `codex`, `ffmpeg`…) à placer en tête du `PATH` des tests. */
export const FAKE_BIN_DIR = join(REPO_ROOT, 'tests/helpers/fake-bin')
