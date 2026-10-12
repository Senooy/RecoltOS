/**
 * Types IA (renommages : `saveId` → `itemUuid`). Recherche visuelle supprimée.
 * Interdits : mode « bare » de claude ; codex toujours isolé ; aucun appel sans consentement.
 */
import { z } from 'zod'

export type AiProviderId = 'claude' | 'codex' | 'none'
export type AiCliId = Exclude<AiProviderId, 'none'>
export type AiField = 'title' | 'description' | 'tags' | 'ocr'
export const AI_FIELDS = ['title', 'description', 'tags', 'ocr'] as const
export type AiTask = 'analyze' | 'imagePrompt'
export const AI_TASKS = ['analyze', 'imagePrompt'] as const

export interface AiMedia {
  path: string
  mime: 'image/jpeg'
  bytes: number
  width: number
  height: number
}

export interface AiPost {
  authorName: string
  authorHandle: string
  caption: string
  quoted?: { authorName: string; authorHandle: string; caption: string }
}

export interface AiInput {
  itemUuid: string
  kind: 'image' | 'video' | 'tweet' | 'url'
  /** 0 (post texte), 1 (image, url), 1 à 3 (vidéo, carrousel) ; redimensionnés, EXIF retiré. */
  media: AiMedia[]
  context: {
    sourceLabel?: 'X' | 'Instagram' | 'Cosmos' | 'Web'
    /** Nom d'hôte seul, jamais l'URL complète. */
    sourceHost?: string
    pageTitle?: string
    videoDurationSec?: number
    carousel?: { total: number; slideNumbers: number[] }
    post?: AiPost
  }
  /** Tags existants proposés au modèle (≤ 60). */
  vocabulary: string[]
}

export interface AiAnalysis {
  title: string
  description: string
  tags: string[]
  ocr: string
}
export interface AiImagePrompt {
  prompt: string
  style: string
}

export interface AiCallMeta {
  provider: AiCliId
  model?: string
  durationMs: number
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
  sentFiles: { name: string; bytes: number; width: number; height: number }[]
  sentTextChars: number
  promptSha256: string
}
export interface AiResult<T> {
  value: T
  meta: AiCallMeta
}

export interface AiCallOptions {
  signal: AbortSignal
  timeoutMs: number
  model?: string
  effort?: 'low' | 'medium'
  jobId?: number
  /** Dossier du job (`<sandbox>/jobs/<id>`) : JPEG préparés, `schema.json`, `out.json` (codex). */
  jobDir?: string
  /** 2ᵉ essai après une sortie invalide : prompt renforcé. */
  retry?: boolean
}

export const AI_ERROR_CODES = [
  'NOT_INSTALLED',
  'NOT_AUTHENTICATED',
  'RATE_LIMITED',
  'TIMEOUT',
  'CANCELLED',
  'BAD_OUTPUT',
  'PROCESS',
  'FILE_MISSING',
  'UNSUPPORTED_CLI',
  'DISABLED',
  'TOOL_VIOLATION',
] as const
export type AiErrorCode = (typeof AI_ERROR_CODES)[number]

export interface AiErrorOptions {
  retryable?: boolean
  resetAt?: number
  raw?: string
}

export class AiError extends Error {
  readonly code: AiErrorCode
  readonly opts: AiErrorOptions | undefined

  constructor(code: AiErrorCode, msg: string, opts?: AiErrorOptions) {
    super(msg)
    this.name = 'AiError'
    this.code = code
    this.opts = opts
  }
}

export const ProviderStatus = z.object({
  installed: z.boolean(),
  path: z.string().optional(),
  version: z.string().optional(),
  /** Copies trouvées par le shell de login (feuille « Changer »). */
  candidates: z.array(z.object({ path: z.string(), version: z.string().optional() })).optional(),
  loggedIn: z.boolean().optional(),
  /** 'max', 'ChatGPT'… */
  plan: z.string().optional(),
  authKind: z.enum(['subscription', 'api_key', 'unknown']).optional(),
  warnings: z.array(z.string()),
})
export type ProviderStatus = z.output<typeof ProviderStatus>

export const ProviderTestResult = z.object({
  ok: z.boolean(),
  status: ProviderStatus,
  latencyMs: z.number().optional(),
  model: z.string().optional(),
  error: z.string().optional(),
})
export type ProviderTestResult = z.output<typeof ProviderTestResult>

export interface AiProvider {
  readonly id: AiProviderId
  status(): Promise<ProviderStatus>
  test(o: { live: boolean }): Promise<ProviderTestResult>
  /** Appel unique utilisé par la file (titre + description + tags + OCR). */
  analyze(i: AiInput, o: AiCallOptions): Promise<AiResult<AiAnalysis>>
  describe(i: AiInput, o: AiCallOptions): Promise<AiResult<{ description: string }>>
  title(i: AiInput, o: AiCallOptions): Promise<AiResult<{ title: string }>>
  tags(i: AiInput, o: AiCallOptions): Promise<AiResult<{ tags: string[] }>>
  ocr(i: AiInput, o: AiCallOptions): Promise<AiResult<{ ocr: string }>>
  imagePrompt(i: AiInput, o: AiCallOptions): Promise<AiResult<AiImagePrompt>>
}

export const PauseReason = z.enum([
  'RATE_LIMITED',
  'HOUR_BUDGET',
  'DAY_BUDGET',
  'HARD_CAP',
  'USER',
  'NOT_AUTHENTICATED',
  'NOT_INSTALLED',
])
export type PauseReason = z.output<typeof PauseReason>

/** Version du texte de consentement : la changer redemande l'accord. */
export const AI_CONSENT_VERSION = 1
