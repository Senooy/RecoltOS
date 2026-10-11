/**
 * `prefs.json` = `PrefsSchema` (ARCHI §3.3 + delta PLAN §4.5, ERRATA §B, §G).
 *
 * Zod 4 : `.default()` court-circuite le parseur ; les sous-objets utilisent `.prefault({})`
 * pour que leurs défauts internes s'appliquent. `PrefsSchema.parse({})` = tous les défauts.
 * Pas de secret partagé avec l'hôte (PLAN §1.18), aucun réglage d'embeddings (ERRATA §G).
 */
import { z } from 'zod'
import { Accelerator } from './accelerator'
import { SortMode, Theme } from './enums'
import { AbsPath } from './ipc/define'

/** Identifiant de modèle passé en argv d'une CLI : pas de tiret initial ni d'espace (AI §3). */
const ModelId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i, 'identifiant de modèle invalide')

export const CaptureMode = z.enum(['region', 'window', 'screen'])
export type CaptureMode = z.output<typeof CaptureMode>

export const AiProviderPref = z.enum(['off', 'claude', 'codex'])
export const AiFallbackPref = z.enum(['none', 'claude', 'codex'])

export const CapturePrefs = z.object({
  /** Accélérateur Electron positionnel, construit depuis `e.code` (SPACES §2.2). */
  shortcut: Accelerator.default('CommandOrControl+Shift+S'),
  /** Libellé de la touche sur la disposition active (`getLayoutMap()`). */
  shortcutLabel: z.string().default('S'),
  mode: CaptureMode.default('region'),
  /** `null` = bibliothèque seule ; le Bureau est proposé au premier lancement (WP-33). */
  dropFolder: AbsPath.nullable().default(null),
  notify: z.boolean().default(true),
  hideApp: z.boolean().default(true),
  copyToClipboard: z.boolean().default(false),
  promptShown: z.boolean().default(false),
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
  /** `off` tant que l'utilisateur n'a pas choisi un fournisseur ET donné son consentement. */
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

export const ToolsPrefs = z.object({
  ffmpeg: z.string().optional(),
  ffprobe: z.string().optional(),
  sips: z.string().optional(),
  claude: z.string().optional(),
  codex: z.string().optional(),
})

export const StoragePrefs = z.object({
  /** Gouverne `avatar.fetch`, `remote.fetch`, `media.download` (ERRATA §B). */
  downloadRemoteMedia: z.boolean().default(true),
})

export const PrefsSchema = z.object({
  version: z.literal(1).default(1),
  theme: Theme.default('system'),
  defaultSort: SortMode.default('recent'),
  /** 2 à 8 colonnes (PLAN §1.22). */
  defaultColumns: z.number().int().min(2).max(8).default(4),
  defaultMode: z.enum(['library', 'collections', 'spaces', 'search']).default('library'),
  hoverPlay: z.boolean().default(true),
  reduceMotion: z.enum(['system', 'always']).default('system'),
  spacesWheel: z.enum(['scroll', 'zoom']).default('scroll'),
  /** Lecteur de la vue détail ; grille et étagère restent muettes. */
  videoMuted: z.boolean().default(false),
  /** 0 = jamais. */
  trashAutoEmptyDays: z
    .union([z.literal(0), z.literal(7), z.literal(30), z.literal(90)])
    .default(0),
  capture: CapturePrefs.prefault({}),
  sync: SyncPrefs.prefault({}),
  ai: AiPrefs.prefault({}),
  tools: ToolsPrefs.prefault({}),
  storage: StoragePrefs.prefault({}),
})

export type Prefs = z.output<typeof PrefsSchema>
export type PrefsInput = z.input<typeof PrefsSchema>

export const DEFAULT_PREFS: Prefs = PrefsSchema.parse({})

/** Patch profond : chaque sous-objet est partiel. Validé APRÈS fusion par `mergePrefs`. */
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

/** Fusionne un patch dans des prefs et revalide l'ensemble (lève une `ZodError` si invalide). */
export function mergePrefs(current: Prefs, patch: PrefsPatch): Prefs {
  return PrefsSchema.parse(deepMerge(current, patch))
}

/** Retire `key` d'un objet (copie) : évite `delete` et la mutation de l'entrée. */
function omitKey(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key))
}

/**
 * Retire du brut la valeur située à `path` (ou, si un ancêtre n'est pas un objet, la branche
 * entière). Renvoie `undefined` si rien ne peut être retiré.
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
 * Lecture tolérante d'un `prefs.json` : réparation champ par champ. Chaque erreur de validation
 * retire seulement le chemin fautif (son défaut s'applique via `.default()`/`.prefault()`), puis
 * on revalide. Les autres réglages valides (thème, consentement IA, raccourci) sont conservés.
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
