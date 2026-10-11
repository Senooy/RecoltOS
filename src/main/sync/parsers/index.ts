/**
 * Parseurs de sync X / Instagram / Cosmos (WP-55). Fonctions pures : `json` brut d'un `sync.page`
 * → `PageParseResult` (publications normalisées + curseur, ou erreur classée), jamais d'exception.
 */
import { parseCosmosSavesPage } from './cosmos'
import { parseInstagramSavedPage } from './instagram'
import type { PageParseOptions, PageParseResult, SyncPlatform } from './types'
import { parseXBookmarksPage } from './x'

export { parseXBookmarksPage, parseXDate, snowflakeMs, xAvatar400, xPhotoOrig, bestMp4 } from './x'
export { parseInstagramSavedPage, parseInstagramMediaInfo, igExpiry } from './instagram'
export { parseCosmosSavesPage, cosmosOriginal } from './cosmos'
export * from './types'

/** Aiguillage par plateforme (pages `sync.page` et captures passives). */
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
