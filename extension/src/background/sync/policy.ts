/**
 * Choice of the execution target (replaces the previous one). The BACKGROUND is always the
 * primary target, for all three platforms and all triggers. Fallbacks, only if the background
 * request is REFUSED (`blocked`): an already-open tab of the platform (never reloaded nor
 * brought to the foreground), then a tab created in the background ONLY if the option
 * « Open a background tab if needed » is enabled (disabled by default).
 */
import type { Trigger } from '../../../../src/shared/bridge/envelope'

export type ExecTarget =
  { kind: 'background' } | { kind: 'tab'; tabId: number } | { kind: 'created_tab' }

export interface PolicyInput {
  trigger: Trigger
  /** Already-open, loaded tab of the platform, if any. */
  existingTabId: number | null
  allowBackgroundTab: boolean
}

/** Targets to try, in order. */
export function targetsFor(p: PolicyInput): ExecTarget[] {
  const out: ExecTarget[] = [{ kind: 'background' }]
  if (p.existingTabId !== null) out.push({ kind: 'tab', tabId: p.existingTabId })
  if (p.allowBackgroundTab) out.push({ kind: 'created_tab' })
  return out
}
