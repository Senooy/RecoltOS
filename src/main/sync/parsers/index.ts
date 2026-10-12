/**
 * Sync parsers for X / Instagram / Cosmos. Pure functions: raw `json` of a `sync.page`
 * → `PageParseResult` (normalized posts + cursor, or a classified error), never throws.
 */
import { parseCosmosSavesPage } from './cosmos'
import { parseInstagramSavedPage } from './instagram'
import type { PageParseOptions, PageParseResult, SyncPlatform } from './types'
import { parseXBookmarksPage } from './x'

export { parseXBookmarksPage, parseXDate, snowflakeMs, xAvatar400, xPhotoOrig, bestMp4 } from './x'
export { parseInstagramSavedPage, parseInstagramMediaInfo, igExpiry } from './instagram'
export { parseCosmosSavesPage, cosmosOriginal } from './cosmos'
export * from './types'

/** Routing by platform (`sync.page` pages and passive captures). */
export function parseSyncPage(
  platform: SyncPlatform,
  json: unknown,
  opts: PageParseOptions = {},
): PageParseResult {
  switch (platform) {
    case 'x':
      return parseXBookmarksPage(json, opts)
    case 'instagram':
      return parseInstagramSavedPage(json, opts)
    case 'cosmos':
      return parseCosmosSavesPage(json, opts)
  }
}
