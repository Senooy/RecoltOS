/** Temporary library (real file: WAL and `VACUUM INTO` require a path). */
import type Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openLibraryDb, type OpenLibraryDbOptions } from '../../../src/main/db/open'
import { createRepos, type Repos } from '../../../src/main/db/repos'

export const T0 = 1_790_000_000_000

export interface TestLib {
  root: string
  db: Database.Database
  repos: Repos
  clock: { now: number }
  cleanup(): void
}

export function tmpDir(prefix = 'recolt-db-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export function openTestLib(opts: OpenLibraryDbOptions = {}): TestLib {
  const root = tmpDir()
  const { db } = openLibraryDb(root, { busyTimeout: 50, ...opts })
  const clock = { now: T0 }
  const repos = createRepos(db, { now: () => clock.now })
  return {
    root,
    db,
    repos,
    clock,
    cleanup() {
      if (db.open) db.close()
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

export const uuidN = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
