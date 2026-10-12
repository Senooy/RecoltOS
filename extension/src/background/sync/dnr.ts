/**
 * `declarativeNetRequest` rules for SESSION: for requests issued by the background script
 * (`tabIds: [-1]`) to the platform domains, `Origin` and `Referer` are rewritten to the site
 * itself (a `chrome-extension://` / `moz-extension://` origin would be refused or flagged).
 * Tab requests are never modified.
 */
import { BRIDGE_PLATFORMS } from '../../../../src/shared/bridge/constants'
import { api } from '../../lib/api'
import { endpoint, ENDPOINTS } from '../../lib/endpoints'

export const RULE_BASE_ID = 7100

export function headerRules(): chrome.declarativeNetRequest.Rule[] {
  return BRIDGE_PLATFORMS.map((p, i) => ({
    id: RULE_BASE_ID + i,
    priority: 1,
    action: {
      type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
      requestHeaders: [
        {
          header: 'origin',
          operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
          value: ENDPOINTS[p].origin,
        },
        {
          header: 'referer',
          operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
          value: endpoint(p, 'referer'),
        },
      ],
    },
    condition: {
      requestDomains: ENDPOINTS[p].domains,
      tabIds: [-1],
      resourceTypes: [
        'xmlhttprequest' as chrome.declarativeNetRequest.ResourceType,
        'other' as chrome.declarativeNetRequest.ResourceType,
      ],
    },
  }))
}

let installed: Promise<void> | null = null

/** Installs the header rules (once per background script startup). */
export function ensureHeaderRules(): Promise<void> {
  installed ??= (async () => {
    const dnr = api().declarativeNetRequest
    if (!dnr?.updateSessionRules) return
    const rules = headerRules()
    // In tests, the three platforms share the same host: a single rule is enough.
    const unique = rules.filter(
      (r, i) =>
        rules.findIndex(
          (x) => x.condition.requestDomains?.join() === r.condition.requestDomains?.join(),
        ) === i,
    )
    await dnr.updateSessionRules({
      removeRuleIds: rules.map((r) => r.id),
      addRules: unique,
    })
  })().catch(() => {
    installed = null
  })
  return installed
}
