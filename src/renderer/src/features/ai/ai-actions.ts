/**
 * AI actions shared by the Details panel and the context menu. Without an engine or without
 * consent, the "Change" sheet opens instead of calling.
 */
import type { AiField } from '../../../../shared/ai-types'
import { toast } from '../../components/ui'
import { tr } from '../../i18n'
import { rpc } from '../../lib/rpc'
import { usePrefs } from '../../state/prefs'
import { aiFail, aiReady, useAi } from './ai-store'

export async function analyzeItems(
  uuids: string[],
  opts: { force?: boolean; fields?: AiField[]; task?: 'analyze' | 'imagePrompt' } = {},
): Promise<void> {
  const provider = usePrefs.getState().prefs.ai.provider
  if (!aiReady(provider, useAi.getState().consentVersion)) {
    useAi.getState().openSheet()
    return
  }
  try {
    await rpc('ai.enqueue', {
      itemUuids: uuids,
      task: opts.task ?? 'analyze',
      ...(opts.force ? { force: true } : {}),
      ...(opts.fields ? { fields: opts.fields } : {}),
    })
    toast(tr.aiUi.enqueued)
  } catch (err) {
    aiFail(err)
  }
}

export async function setAiExcluded(uuids: string[], excluded: boolean): Promise<void> {
  try {
    await rpc('items.setAiExcluded', { uuids, excluded })
  } catch (err) {
    aiFail(err)
  }
}
