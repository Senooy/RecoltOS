/**
 * Real import under Node: copy of `moodmark.db` (never the source) + GatherOS files
 * cloned read-only into a temporary library.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLibraryDb } from '../../src/main/db/open'
import { createRepos } from '../../src/main/db/repos'
import { pickLibrary, type GatherosLibrary } from '../../src/main/importers/gatheros/detect'
import { runGatherosImport } from '../../src/main/importers/gatheros/run'
import type { LibraryContext } from '../../src/main/library/library-context'
import { libraryPaths } from '../../src/main/library/paths'
import { cloneFile, hashFile } from '../../src/main/workers/media/files'
import { ImportOptions } from '../../src/shared/ipc/import'

export const REAL_ROOT = process.env.RECOLTOS_REAL_LIBRARY ?? ''
/** Working copy of the database (otherwise: copy made by the importer from the source). */
export const REAL_DB = process.env.RECOLTOS_REAL_DB ?? ''

export function realSource(): GatherosLibrary {
  const lib = pickLibrary(REAL_ROOT)
  return REAL_DB ? { ...lib, dbPath: REAL_DB } : lib
}

export function openTmpLibrary(root = mkdtempSync(join(tmpdir(), 'recolt-real-'))): LibraryContext {
  const { db } = openLibraryDb(root, {})
  return {
    id: 'lreal',
    name: 'Réelle',
    root,
    paths: libraryPaths(root),
    db,
    repos: createRepos(db),
  }
}

export function importReal(lib: LibraryContext, options: Partial<ImportOptions> = {}) {
  return runGatherosImport(
    { source: realSource(), options: ImportOptions.parse(options) },
    {
      lib,
      hashFile: (abs) => hashFile({ abs }),
      cloneFile: (src, dst) => cloneFile({ src, dst }),
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    },
  )
}
