/**
 * AI status dot in the top bar: visible only when the AI queue is working, waiting
 * or paused. Opens Settings › AI.
 */
import { Sparkles } from 'lucide-react'
import { tr } from '../../i18n'
import { cn } from '../../lib/cn'
import { usePrefs } from '../../state/prefs'
import { useUi } from '../../state/ui'
import { useAi } from './ai-store'

export function AiStatusPill() {
  const queue = useAi((s) => s.queue)
  const provider = usePrefs((s) => s.prefs.ai.provider)
  if (!queue || provider === 'off') return null
  const pending = queue.cli.queued + queue.cli.running
  const paused = queue.cli.providers[provider].paused
  if (pending === 0) return null
  return (
    <button
      type="button"
      data-testid="ai-pill"
      title={tr.aiUi.pillTitle}
      className={cn(
        'mr-1 flex h-[26px] items-center gap-1.5 rounded-full border border-border px-2.5 text-[12px] text-fg-muted',
        'transition-colors hover:border-border-strong hover:text-fg',
      )}
      onClick={() => useUi.getState().openOverlay({ type: 'settings', section: 'ai' })}
    >
      <Sparkles
        size={13}
        strokeWidth={1.75}
        className={cn(queue.cli.running > 0 && !paused && 'animate-pulse')}
      />
      {paused ? tr.aiUi.pillPaused : tr.aiUi.pill(pending)}
    </button>
  )
}
