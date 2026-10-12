/**
 * Porte IA à l'ingestion : `ai_state = 'queued'` seulement si les
 * cinq conditions sont réunies ; sinon `none` (l'enrichissement se propose ensuite en lot).
 */
import { AI_CONSENT_VERSION } from '../../shared/ai-types'
import type { Prefs } from '../../shared/prefs'
import type { SettingsRepo } from '../db/repos/settings'
import { PAUSED_SETTING, type PauseEntry } from '../jobs/queue'

export interface AiGateInput {
  prefs: Prefs
  settings: SettingsRepo
  /** Action directe de l'utilisateur (glisser, capture, extension). */
  userAction: boolean
  /** Taille du lot d'une synchro (sinon 1). */
  batchSize?: number
  now: number
}

export function dayKey(now: number): string {
  const d = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  return `ai.autoCount.${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function providerPaused(settings: SettingsRepo, provider: string, now: number): boolean {
  const raw = settings.get(PAUSED_SETTING) as Record<string, PauseEntry> | undefined
  if (!raw || typeof raw !== 'object') return false
  for (const key of ['ai.enrich', `provider:${provider}`]) {
    const p = raw[key]
    if (p && (p.until === null || p.until > now)) return true
  }
  return false
}

/** Pause par fournisseur posée par la porte IA (`ai/gate.ts`, `settings['ai.providerPauses']`). */
function gatePaused(settings: SettingsRepo, provider: string, now: number): boolean {
  const raw = settings.get('ai.providerPauses') as Record<string, { until?: number }> | undefined
  const p = raw && typeof raw === 'object' ? raw[provider] : undefined
  return Boolean(p && (p.until === undefined || p.until > now))
}

/** Décide et, si `queued`, consomme une unité du compteur du jour. */
export function aiGate(i: AiGateInput): 'queued' | 'none' {
  const ai = i.prefs.ai
  if (ai.provider === 'off') return 'none'
  // Jamais d'appel sans consentement, même si `autoNameOnSave` a été importé à vrai.
  if (!ai.consentVersion || ai.consentVersion < AI_CONSENT_VERSION) return 'none'
  if (!ai.autoNameOnSave && !ai.autoAnalyzeOnSave && !ai.autoTag) return 'none'
  if (!i.userAction && (i.batchSize ?? 1) > ai.bulkThreshold) return 'none'
  const key = dayKey(i.now)
  const used = Number(i.settings.get(key) ?? 0)
  if (!(used < ai.maxAutoPerDay)) return 'none'
  if (providerPaused(i.settings, ai.provider, i.now)) return 'none'
  if (gatePaused(i.settings, ai.provider, i.now)) return 'none'
  i.settings.set(key, used + 1, i.now)
  return 'queued'
}
