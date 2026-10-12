/**
 * Sortie commune des parseurs de sync.
 *
 * Les parseurs sont des fonctions PURES : pas de réseau, pas d'horloge, pas d'exception. Ils
 * reçoivent le `json` brut d'un `sync.page` (ou d'un `capture.passive` / `item.data`) et rendent
 * soit une page normalisée, soit une erreur classée. Les URL distantes produites ici sont des
 * DONNÉES pour le téléchargeur de l'app : elles vivent en base (`post_meta`, jobs) et ne
 * partent jamais telles quelles vers le renderer (qui reçoit `PostView`).
 */
import type { BridgePlatform } from '../../../shared/bridge/constants'
import type { PostMeta } from '../../../shared/post-meta'

export type SyncPlatform = BridgePlatform

/** Préfixe de `source_key` par plateforme : `x:<rest_id>`, `ig:<code>`, `cosmos:<id>`. */
export const SOURCE_KEY_PREFIX: Readonly<Record<SyncPlatform, string>> = {
  x: 'x',
  instagram: 'ig',
  cosmos: 'cosmos',
}

/** Auteur normalisé : handle SANS `@`, avatar https (X : `_400x400`). */
export interface NormalizedAuthor {
  /** Identifiant numérique de la plateforme (X `rest_id`, IG `pk`), si connu. */
  id: string | null
  name: string | null
  handle: string | null
  avatarUrl: string | null
}

/** Un média à télécharger, dans l'ordre de la publication (`media[0]` = fichier principal). */
export interface NormalizedMedia {
  type: 'image' | 'video'
  /**
   * Meilleure URL directe : photo X `name=orig`, mp4 au plus haut débit, IG plus grande variante,
   * Cosmos original (sans `?format=webp`). `null` si la vidéo n'existe qu'en HLS.
   */
  url: string | null
  /** URL de repli si l'originale échoue (Cosmos : `?format=jpeg`). */
  fallbackUrl: string | null
  /** Liste de lecture HLS (`.m3u8`), si présente. */
  hlsUrl: string | null
  /** Vrai si seule la variante HLS existe : le téléchargeur passe par ffmpeg `-c copy`. */
  hlsOnly: boolean
  posterUrl: string | null
  width: number | null
  height: number | null
  durationMs: number | null
  /** GIF animé X (vidéo muette en boucle). */
  gif: boolean
}

export interface XPostExtra {
  platform: 'x'
  /** `sortIndex` de l'entrée de timeline (snowflake, plus grand = plus récent). */
  sortIndex: string | null
  conversationId: string | null
  inReplyToId: string | null
  inReplyToHandle: string | null
  /** Réponse de l'auteur à lui-même (fil). Le parent n'est pas dans la page des favoris. */
  selfReply: boolean
  /** Favori sur un repost : le contenu (et la clé) est celui de l'original. */
  retweetedBy: NormalizedAuthor | null
  retweetId: string | null
  /** Le tweet cité existe mais est indisponible (tombstone). */
  quotedUnavailable: boolean
  /** Texte long (`note_tweet`) utilisé à la place de `full_text`. */
  noteTweet: boolean
}

export interface InstagramPostExtra {
  platform: 'instagram'
  /** `pk` numérique du média (sert à `media/<pk>/info/` pour `item.refresh`). */
  pk: string | null
  /** `saved_collection_ids` (mappage éventuel vers des collections RecoltOS). */
  igCollections: string[]
  productType: string | null
  /** 1 image, 2 vidéo, 8 carrousel. */
  mediaType: number
  /** Expiration la plus proche des URL signées (`oe=` hexadécimal), en ms, si lisible. */
  expiresAt: number | null
}

export interface CosmosPostExtra {
  platform: 'cosmos'
  /** Date d'ajout à Cosmos (`createdAt`), en ms. */
  savedAt: number | null
  /** Tuile site web : URL du site (le `kind` est alors `url`). */
  linkUrl: string | null
  websiteTitle: string | null
  /** Légende générée par Cosmos (pas le texte d'un auteur). */
  generatedCaption: string | null
  ownerId: string | null
}

export type PostExtra = XPostExtra | InstagramPostExtra | CosmosPostExtra

export interface NormalizedPost {
  platform: SyncPlatform
  /** `rest_id` X, `code` IG, `id` Cosmos. */
  externalId: string
  /** `x:<rest_id>` | `ig:<code>` | `cosmos:<id>` (= `sync_items.source_key`). */
  sourceKey: string
  /** URL canonique de la publication. */
  sourceUrl: string
  /** `items.kind` visé : suit le 1er média. */
  kind: 'image' | 'video' | 'tweet' | 'url'
  /** Position dans la page (0 = premier rendu par la plateforme, donc le plus récent). */
  position: number
  /** Clé de tri distante brute (`sync_items.remote_sort`) : `sortIndex` X, sinon `null`. */
  remoteSort: string | null
  /** Date de publication (ms epoch UTC) si connue. */
  postedAt: number | null
  /**
   * Heure d'ordre attribuée par `order.ts`. Toujours `null` en sortie de parseur : les
   * parseurs ne lisent pas l'horloge.
   */
  createdAt: number | null
  author: NormalizedAuthor | null
  /** Auteurs à alimenter dans la table `authors` (principal, cité, repost), dédupliqués. */
  authors: NormalizedAuthor[]
  text: string | null
  media: NormalizedMedia[]
  /** `items.post_meta` v1, validé par `PostMetaSchema`. `mediaUuid` = `null`. */
  postMeta: PostMeta
  extra: PostExtra
}

export interface ParseStats {
  /** Entrées examinées (tweets, médias, éléments ; curseurs exclus). */
  entries: number
  /** Publications normalisées rendues. */
  parsed: number
  /** Supprimées ou indisponibles (tombstone, `TweetUnavailable`). */
  unavailable: number
  /** Ignorées volontairement (tuile texte Cosmos, entrée non-tweet). */
  ignored: number
  /** Malformées : isolées et comptées, la page continue. */
  malformed: number
  /** Médias écartés à l'intérieur de publications gardées (sans URL exploitable). */
  mediaDropped: number
}

export interface ParseIssue {
  /** Index de l'entrée dans la page. */
  index: number
  /** Identifiant lisible s'il existe (entryId, code, id). */
  id: string | null
  kind: 'unavailable' | 'ignored' | 'malformed' | 'media_dropped'
  reason: string
}

/** Sous-ensemble de `SyncOutcome` (bridge) que le corps d'une réponse permet de décider. */
export type ParseErrorCode = 'auth_required' | 'rate_limited' | 'api_changed'

export interface ParseError {
  code: ParseErrorCode
  /** Raison courte et stable (`unknown_shape`, `features_missing`, `checkpoint_required`…). */
  reason: string
  /** Message lisible (tronqué), pour le journal. */
  message: string
  /** X 336 : noms des `features` à ajouter à `false` avant de relancer. */
  missingFeatures?: string[]
}

export interface PageParseOk {
  ok: true
  platform: SyncPlatform
  posts: NormalizedPost[]
  /** Curseur de la page suivante ; `null` = fin de pagination. */
  nextCursor: string | null
  stats: ParseStats
  /** Détail des entrées écartées (plafonné à `MAX_ISSUES`). */
  issues: ParseIssue[]
}

export interface PageParseError {
  ok: false
  platform: SyncPlatform
  error: ParseError
}

export type PageParseResult = PageParseOk | PageParseError

export interface PageParseOptions {
  /**
   * Curseur qui a servi à demander cette page. Si la plateforme renvoie le même, la pagination
   * s'arrête (`nextCursor = null`) pour éviter une boucle.
   */
  requestCursor?: string | null
}
