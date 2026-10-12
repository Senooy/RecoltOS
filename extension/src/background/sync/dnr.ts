/**
 * Règles `declarativeNetRequest` de SESSION : pour les requêtes émises par le script
 * d'arrière-plan (`tabIds: [-1]`) vers les domaines des plateformes, `Origin` et `Referer` sont
 * réécrits vers le site lui-même (une origine `chrome-extension://` / `moz-extension://` serait
 * refusée ou signalée). Les requêtes des onglets ne sont jamais modifiées.
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

/** Installe (une fois par démarrage du script d'arrière-plan) les règles d'en-têtes. */
export function ensureHeaderRules(): Promise<void> {
  installed ??= (async () => {
    const dnr = api().declarativeNetRequest
    if (!dnr?.updateSessionRules) return
    const rules = headerRules()
    // En test, les trois plateformes partagent le même hôte : une seule règle suffit.
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
