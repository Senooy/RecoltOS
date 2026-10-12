/**
 * Pause et routage PAR FOURNISSEUR (« ProviderGate ») : une limite Claude ne bloque pas
 * Codex. Pauses persistées dans `settings['ai.providerPauses']` (lues aussi par la porte
 * d'ingestion). Règles de `route` :
 * 1. le principal s'il n'est pas en pause et n'a pas échoué deux fois (PROCESS/TIMEOUT) ;
 * 2. sinon le secours s'il est configuré, connecté et non en pause ;
 * 3. sinon attente jusqu'à `min(until)` (ou attente manuelle sans échéance).
 */
import type { AiCliId, ProviderStatus } from '../../shared/ai-types'
import type { AiPrefs } from '../../shared/prefs'
import type { SettingsRepo } from '../db/repos/settings'

export type GatePauseReason = 'RATE_LIMITED' | 'NOT_AUTHENTICATED' | 'NOT_INSTALLED' | 'USER'
export interface ProviderPause {
  reason: GatePauseReason
  until?: number
  /** Pauses de limite consécutives (paliers 15 / 30 / 60 min). */
  strikes?: number
}

export const PAUSES_SETTING = 'ai.providerPauses'

export type RouteResult =
  { provider: AiCliId; fallback: boolean } | { waitUntil?: number; reason: string }

export class ProviderGate {
  private readonly deps: {
    prefs: () => AiPrefs
    status: (p: AiCliId) => ProviderStatus | undefined
    settings: () => SettingsRepo | null
    clock?: () => number
  }

  constructor(deps: ProviderGate['deps']) {
    this.deps = deps
  }

  private now(): number {
    return (this.deps.clock ?? Date.now)()
  }

  private read(): Partial<Record<AiCliId, ProviderPause>> {
    const raw = this.deps.settings()?.get(PAUSES_SETTING)
    return raw && typeof raw === 'object' ? { ...(raw as Record<AiCliId, ProviderPause>) } : {}
  }

  private write(p: Partial<Record<AiCliId, ProviderPause>>): void {
    const s = this.deps.settings()
    if (!s) return
    if (Object.keys(p).length === 0) s.delete(PAUSES_SETTING)
    else s.set(PAUSES_SETTING, p)
  }

  pause(p: AiCliId, x: ProviderPause): void {
    const all = this.read()
    all[p] = x
    this.write(all)
  }

  resume(p?: AiCliId): void {
    if (!p) return this.write({})
    const all = this.read()
    delete all[p]
    this.write(all)
  }

  /** Pauses actives (les échues sont retirées). */
  paused(): Partial<Record<AiCliId, ProviderPause>> {
    const all = this.read()
    const now = this.now()
    let changed = false
    for (const k of Object.keys(all) as AiCliId[]) {
      const v = all[k]!
      if (v.until !== undefined && v.until <= now) {
        // On garde le compteur de paliers pour la prochaine limite, sans la pause.
        delete all[k]
        changed = true
      }
    }
    if (changed) this.write(all)
    return all
  }

  isPaused(p: AiCliId): boolean {
    return this.paused()[p] !== undefined
  }

  route(job: { failedOn?: readonly string[] }): RouteResult {
    const prefs = this.deps.prefs()
    if (prefs.provider === 'off') return { reason: 'off' }
    const primary = prefs.provider
    const paused = this.paused()
    const fails = (p: AiCliId) => (job.failedOn ?? []).filter((x) => x === p).length
    if (!paused[primary] && fails(primary) < 2) return { provider: primary, fallback: false }
    const fb = prefs.fallback
    if (fb !== 'none' && fb !== primary && !paused[fb]) {
      const st = this.deps.status(fb)
      if (st?.installed !== false && st?.loggedIn !== false && fails(fb) < 2)
        return { provider: fb, fallback: true }
    }
    const untils = [paused[primary], fb !== 'none' ? paused[fb] : undefined]
      .map((x) => x?.until)
      .filter((u): u is number => typeof u === 'number')
    if (!paused[primary] && fails(primary) >= 2) {
      // Deux échecs sur le principal sans secours possible : on retente quand même le principal.
      return { provider: primary, fallback: false }
    }
    return untils.length > 0
      ? { waitUntil: Math.min(...untils), reason: paused[primary]!.reason }
      : { reason: paused[primary]?.reason ?? 'indisponible' }
  }
}
