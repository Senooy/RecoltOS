/**
 * Request budgets per platform: a single budget for all requests to a platform's API
 * (pages, `item.refresh`), minimum gap with jitter, cap per run and per day,
 * shared cooldown doubled each time (30 min → 6 h). CDN downloads are not part of it.
 * State persisted in `sync_state` (`budget_day`, `budget_used`, `cooldown_until`).
 */
import type { BridgePlatform } from '../../shared/bridge/constants'

export interface BudgetConfig {
  minGapMs: number
  maxGapMs: number
  perRun: number
  perDay: number
  cooldownBaseMs: number
  cooldownMaxMs: number
}

export const BUDGETS: Readonly<Record<BridgePlatform, BudgetConfig>> = {
  instagram: {
    minGapMs: 3_000,
    maxGapMs: 6_000,
    perRun: 20,
    perDay: 200,
    cooldownBaseMs: 30 * 60_000,
    cooldownMaxMs: 6 * 3_600_000,
  },
  x: {
    minGapMs: 2_000,
    maxGapMs: 4_000,
    perRun: 50,
    perDay: 600,
    cooldownBaseMs: 15 * 60_000,
    cooldownMaxMs: 6 * 3_600_000,
  },
  cosmos: {
    minGapMs: 1_000,
    maxGapMs: 2_000,
    perRun: 25,
    perDay: 400,
    cooldownBaseMs: 15 * 60_000,
    cooldownMaxMs: 6 * 3_600_000,
  },
}

export interface BudgetState {
  budgetDay: string | null
  budgetUsed: number
  cooldownUntil: number | null
  /** Number of successive cooldowns (for the doubling). */
  cooldowns: number
}

export function dayOf(now: number): string {
  const d = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export type SpendKind = 'page' | 'refresh'

export class PlatformBudget {
  readonly platform: BridgePlatform
  readonly cfg: BudgetConfig
  private state: BudgetState
  private lastAt = 0
  private runUsed = 0
  private readonly persist: (s: BudgetState) => void
  private readonly random: () => number

  constructor(
    platform: BridgePlatform,
    initial: BudgetState,
    persist: (s: BudgetState) => void,
    opts: { cfg?: BudgetConfig; random?: () => number } = {},
  ) {
    this.platform = platform
    this.cfg = opts.cfg ?? BUDGETS[platform]
    this.state = { ...initial }
    this.persist = persist
    this.random = opts.random ?? Math.random
  }

  get snapshot(): BudgetState {
    return { ...this.state }
  }

  startRun(): void {
    this.runUsed = 0
  }

  private roll(now: number): void {
    const day = dayOf(now)
    if (this.state.budgetDay !== day) {
      this.state.budgetDay = day
      this.state.budgetUsed = 0
    }
  }

  /** Reasoned refusal, or delay to wait before the call (jitter between min and max). */
  check(
    kind: SpendKind,
    now: number,
  ):
    | { ok: true; waitMs: number }
    | { ok: false; reason: 'cooldown' | 'run' | 'day'; until?: number } {
    this.roll(now)
    if (this.state.cooldownUntil !== null && this.state.cooldownUntil > now) {
      return { ok: false, reason: 'cooldown', until: this.state.cooldownUntil }
    }
    if (kind === 'page' && this.runUsed >= this.cfg.perRun) return { ok: false, reason: 'run' }
    if (this.state.budgetUsed >= this.cfg.perDay) return { ok: false, reason: 'day' }
    const gap = this.cfg.minGapMs + this.random() * (this.cfg.maxGapMs - this.cfg.minGapMs)
    return { ok: true, waitMs: Math.max(0, Math.round(this.lastAt + gap - now)) }
  }

  spend(kind: SpendKind, now: number): void {
    this.roll(now)
    this.lastAt = now
    this.state.budgetUsed += 1
    if (kind === 'page') this.runUsed += 1
    this.persist(this.snapshot)
  }

  /** Shared cooldown (pages AND refresh), doubled each time up to the cap. */
  cooldown(now: number, until?: number): number {
    const ms = Math.min(this.cfg.cooldownBaseMs * 2 ** this.state.cooldowns, this.cfg.cooldownMaxMs)
    this.state.cooldowns += 1
    this.state.cooldownUntil =
      until && until > now ? Math.min(until, now + this.cfg.cooldownMaxMs) : now + ms
    this.persist(this.snapshot)
    return this.state.cooldownUntil
  }

  /** Successful run: the doubling restarts from zero. */
  success(): void {
    if (this.state.cooldowns === 0 && this.state.cooldownUntil === null) return
    this.state.cooldowns = 0
    this.state.cooldownUntil = null
    this.persist(this.snapshot)
  }
}
