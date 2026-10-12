/**
 * `ai.*` handlers. Any action that triggers a call (enqueue,
 * batch.start, live test) requires `consentVersion` and `provider ≠ 'off'` (checked by the service).
 */
import { AI_CONSENT_VERSION } from '../../../shared/ai-types'
import { requireAiService } from '../../ai/service'
import { requirePrefsStore } from '../../prefs/store'
import type { DomainHandlers } from '../router'

export const aiHandlers: DomainHandlers<'ai'> = {
  'ai.detect': () => requireAiService().detect(),
  'ai.status': () => {
    const ai = requirePrefsStore().get().ai
    return {
      provider: ai.provider,
      fallback: ai.fallback,
      consentVersion:
        ai.consentVersion !== undefined && ai.consentVersion >= AI_CONSENT_VERSION
          ? ai.consentVersion
          : null,
      queue: requireAiService().snapshot(),
    }
  },
  'ai.test': ({ provider, live }) => requireAiService().test(provider, live),
  'ai.consent': ({ version }) => requireAiService().consent(version),
  'ai.previewPayload': ({ itemUuid, task }) => requireAiService().previewPayload(itemUuid, task),
  'ai.estimate': ({ filter }) => requireAiService().estimate(filter),
  'ai.enqueue': (input) => requireAiService().enqueue(input),
  'ai.batch.create': ({ scope, collectionUuid }) =>
    requireAiService().batchCreate(scope, collectionUuid),
  'ai.batch.start': ({ planId }) => requireAiService().batchStart(planId),
  'ai.queue.control': ({ action, batchUuid, provider }) =>
    requireAiService().control({ action, batchUuid, provider }),
  'ai.budget.override': ({ until }) => requireAiService().budgetOverride(until),
  'ai.calls.list': ({ limit }) => requireAiService().callsList(limit),
  'ai.calls.clear': () => ({ count: requireAiService().callsClear() }),
}
