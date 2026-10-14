/**
 * `prefs.json` = `PrefsSchema`.
 *
 * Zod 4: `.default()` short-circuits the parser; sub-objects use `.prefault({})`
 * so that their inner defaults apply. `PrefsSchema.parse({})` = all defaults.
 * No secret shared with the host, no embeddings setting.
 */
import { z } from 'zod'
import { Accelerator } from './accelerator'
import { SortMode, Theme } from './enums'
import { LANGUAGE_PREFS } from './i18n/lang'
import { AbsPath } from './ipc/define'

/** Model identifier passed in a CLI's argv: no leading dash or space. */
const ModelId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i, 'invalid model identifier')

export const CaptureMode = z.enum(['region', 'window', 'screen'])
export type CaptureMode = z.output<typeof CaptureMode>

export const AiProviderPref = z.enum(['off', 'claude', 'codex'])
export const AiFallbackPref = z.enum(['none', 'claude', 'codex'])

export const CapturePrefs = z.object({
  /** Positional Electron accelerator, built from `e.code`. */
  shortcut: Accelerator.default('CommandOrControl+Shift+S'),
  /** Key label on the active layout (`getLayoutMap()`). */
  shortcutLabel: z.string().default('S'),
  mode: CaptureMode.default('region'),
  /** `null` = library only; the Desktop is offered at first launch. */
  dropFolder: AbsPath.nullable().default(null),
  notify: z.boolean().default(true),
  hideApp: z.boolean().default(true),
  copyToClipboard: z.boolean().default(false),
  promptShown: z.boolean().default(false),
  /** The Desktop was offered as the drop folder at first launch. */
  dropFolderInit: z.boolean().default(false),
})

export const SyncPrefs = z.object({
  x: z.boolean().default(false),
  instagram: z.boolean().default(false),
  cosmos: z.boolean().default(false),
})

export const ClaudePrefs = z.object({
  path: z.string().optional(),
  model: ModelId.default('sonnet'),
  effort: z.enum(['low', 'medium']).default('low'),
  imageMode: z.enum(['read-tool', 'base64-stream']).default('read-tool'),
  outputMode: z.enum(['stream-json', 'json']).default('stream-json'),
  restricted: z.boolean().default(false),
})

export const CodexPrefs = z.object({
  path: z.string().optional(),
  model: ModelId.optional(),
  effort: z.enum(['low', 'medium']).default('low'),
})

export const AiPrefs = z.object({
  /** `off` until the user has chosen a provider AND given consent. */
  provider: AiProviderPref.default('off'),
  fallback: AiFallbackPref.default('none'),
  autoNameOnSave: z.boolean().default(true),
  autoAnalyzeOnSave: z.boolean().default(true),
  autoTag: z.boolean().default(false),
  maxAutoPerDay: z.number().int().min(0).max(1000).default(50),
  bulkThreshold: z.number().int().min(1).default(20),
  perHour: z.number().int().min(1).default(120),
  perDay: z.number().int().min(1).default(600),
  hardPerDay: z.number().int().min(1).default(1000),
  minGapMs: z.number().int().min(0).default(5000),
  concurrency: z.union([z.literal(1), z.literal(2)]).default(1),
  titlePolicy: z.enum(['empty', 'always']).default('empty'),
  claude: ClaudePrefs.prefault({}),
  codex: CodexPrefs.prefault({}),
  lastSeenVersions: z
    .object({ claude: z.string().optional(), codex: z.string().optional() })
    .prefault({}),
  consentVersion: z.number().int().optional(),
  consentAt: z.number().int().optional(),
})

export type AiPrefs = z.output<typeof AiPrefs>

export const ToolsPrefs = z.object({
  ffmpeg: z.string().optional(),
  ffprobe: z.string().optional(),
  sips: z.string().optional(),
  claude: z.string().optional(),
  codex: z.string().optional(),
})

export const StoragePrefs = z.object({
  /** Governs `avatar.fetch`, `remote.fetch`, `media.download`. */
  downloadRemoteMedia: z.boolean().default(true),
})

export const UpdatesPrefs = z.object({
  /** Checks GitHub Releases at launch and every 6 h, downloads in the background. */
  auto: z.boolean().default(true),
})

export const UiPrefs = z.object({
  /** Interface language: `system` follows the first preferred language of the Mac (French or English). */
  language: z.enum(LANGUAGE_PREFS).default('system'),
})

export const PrefsSchema = z.object({
  version: z.literal(1).default(1),
  theme: Theme.default('system'),
  defaultSort: SortMode.default('recent'),
  /** 2 to 8 columns. */
  defaultColumns: z.number().int().min(2).max(8).default(4),
  defaultMode: z.enum(['library', 'collections', 'spaces', 'search']).default('library'),
  hoverPlay: z.boolean().default(true),
  reduceMotion: z.enum(['system', 'always']).default('system'),
  spacesWheel: z.enum(['scroll', 'zoom']).default('scroll'),
  /** Player of the detail view; grid and shelf stay silent. */
  videoMuted: z.boolean().default(false),
  /** 0 = never. */
  trashAutoEmptyDays: z
    .union([z.literal(0), z.literal(7), z.literal(30), z.literal(90)])
    .default(0),
  capture: CapturePrefs.prefault({}),
  sync: SyncPrefs.prefault({}),
  ai: AiPrefs.prefault({}),
  tools: ToolsPrefs.prefault({}),
  storage: StoragePrefs.prefault({}),
  ui: UiPrefs.prefault({}),
  updates: UpdatesPrefs.prefault({}),
})

export type Prefs = z.output<typeof PrefsSchema>
export type PrefsInput = z.input<typeof PrefsSchema>

export const DEFAULT_PREFS: Prefs = PrefsSchema.parse({})

/** Deep patch: each sub-object is partial. Validated AFTER merging via `mergePrefs`. */
export type PrefsPatch = {
  [K in keyof Prefs]?: Prefs[K] extends readonly unknown[]
    ? Prefs[K]
    : Prefs[K] extends Record<string, unknown>
      ? {
          [S in keyof Prefs[K]]?: Prefs[K][S] extends Record<string, unknown>
            ? Partial<Prefs[K][S]>
            : Prefs[K][S]
        }
      : Prefs[K]
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    const cur = out[k]
    out[k] = isPlainObject(cur) && isPlainObject(v) ? deepMerge(cur, v) : v
  }
  return out
}

/** Merges a patch into prefs and revalidates everything (throws a `ZodError` if invalid). */
export function mergePrefs(current: Prefs, patch: PrefsPatch): Prefs {
  return PrefsSchema.parse(deepMerge(current, patch))
}

/** Removes `key` from an object (copy): avoids `delete` and mutating the input. */
function omitKey(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key))
}

/**
 * Removes from the raw data the value located at `path` (or, if an ancestor is not an object, the branch
 * as a whole). Returns `undefined` if nothing can be removed.
 */
function withoutPath(
  root: unknown,
  path: readonly PropertyKey[],
): Record<string, unknown> | undefined {
  if (!isPlainObject(root) || path.length === 0) return undefined
  const [head, ...rest] = path
  const key = String(head)
  if (rest.length === 0) return omitKey(root, key)
  const nextChild = withoutPath(root[key], rest)
  return nextChild === undefined ? omitKey(root, key) : { ...root, [key]: nextChild }
}

/**
 * Tolerant reading of a `prefs.json`: field-by-field repair. Each validation error
 * only removes the faulty path (its default applies via `.default()`/`.prefault()`), then
 * revalidates. The other valid settings (theme, AI consent, shortcut) are kept.
 */
export function parsePrefsLenient(raw: unknown): Prefs {
  let candidate: unknown = raw
  for (let attempt = 0; attempt < 100; attempt++) {
    const r = PrefsSchema.safeParse(candidate)
    if (r.success) return r.data
    const issue = r.error.issues[0]
    const next = issue ? withoutPath(candidate, issue.path) : undefined
    if (next === undefined) break
    candidate = next
  }
  return DEFAULT_PREFS
}
