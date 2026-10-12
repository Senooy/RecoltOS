/**
 * Aggregate of a library's repos once opened (one connection, shared prepared statements).
 * No embeddings repo: visual search removed from V1.
 */
import type Database from 'better-sqlite3'
import { createAuthorsRepo } from './authors'
import { createCollectionsRepo } from './collections'
import { createItemsRepo } from './items'
import { createJobsRepo } from './jobs'
import { createMediaRepo } from './media'
import { createSearchRepo } from './search'
import { createSettingsRepo } from './settings'
import { createSpacesRepo } from './spaces'
import { createSyncRepo } from './sync'
import { createTagsRepo } from './tags'
import { createTombstonesRepo } from './tombstones'
import type { RepoOptions } from './util'

export function createRepos(db: Database.Database, opts: RepoOptions = {}) {
  return {
    items: createItemsRepo(db, opts),
    media: createMediaRepo(db, opts),
    authors: createAuthorsRepo(db, opts),
    collections: createCollectionsRepo(db, opts),
    tags: createTagsRepo(db, opts),
    spaces: createSpacesRepo(db, opts),
    jobs: createJobsRepo(db, opts),
    search: createSearchRepo(db, opts),
    settings: createSettingsRepo(db, opts),
    sync: createSyncRepo(db, opts),
    tombstones: createTombstonesRepo(db, opts),
  }
}

export type Repos = ReturnType<typeof createRepos>
export type { RepoOptions } from './util'
