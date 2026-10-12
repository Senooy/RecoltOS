/**
 * État IA côté renderer : instantané de la file (`evt:ai.queue`), état des fournisseurs
 * (`ai.detect`, à la demande), dialogues IA (feuille « Changer », « Enrichir », aperçu).
 */
import { create } from 'zustand'
import type { ProviderStatus } from '../../../../shared/ai-types'
import type { QueueSnapshot } from '../../../../shared/dto/ai'
import { tr } from '../../i18n'
import { RpcError, isNotImplemented, rpc, subscribe } from '../../lib/rpc'
import { toast } from '../../components/ui'

export type EnrichScope = 'import' | 'unanalyzed'

interface AiState {
  queue: QueueSnapshot | null
  consentVersion: number | null
  detect: { claude: ProviderStatus; codex: ProviderStatus } | null
  detecting: boolean
  sheetOpen: boolean
  enrich: EnrichScope | null
  preview: { itemUuid: string | null; task: 'analyze' | 'imagePrompt' } | null
  refresh: () => Promise<void>
  runDetect: () => Promise<void>
  openSheet: () => void
  closeSheet: () => void
  openEnrich: (scope: EnrichScope) => void
  closeEnrich: () => void
  openPreview: (itemUuid: string | null, task?: 'analyze' | 'imagePrompt') => void
  closePreview: () => void
}

export const useAi = create<AiState>()((set, get) => ({
  queue: null,
  consentVersion: null,
  detect: null,
  detecting: false,
  sheetOpen: false,
  enrich: null,
  preview: null,
  async refresh() {
    try {
      const s = await rpc('ai.status')
      set({ queue: s.queue, consentVersion: s.consentVersion })
    } catch (err) {
      if (!isNotImplemented(err)) console.warn('[ai] état', err)
    }
  },
  async runDetect() {
    if (get().detecting) return
    set({ detecting: true })
    try {
      const d = await rpc('ai.detect')
      set({ detect: d })
    } catch (err) {
      if (!isNotImplemented(err)) console.warn('[ai] détection', err)
    } finally {
      set({ detecting: false })
    }
  },
  openSheet: () => set({ sheetOpen: true }),
  closeSheet: () => set({ sheetOpen: false }),
  openEnrich: (scope) => set({ enrich: scope }),
  closeEnrich: () => set({ enrich: null }),
  openPreview: (itemUuid, task = 'analyze') => set({ preview: { itemUuid, task } }),
  closePreview: () => set({ preview: null }),
}))

/** Abonnement aux événements IA (monté une fois par `AiDialogs`). */
export function followAiEvents(): () => void {
  void useAi.getState().refresh()
  const offQueue = subscribe('ai.queue', (queue) => useAi.setState({ queue }))
  const offPrefs = subscribe('prefs.changed', () => void useAi.getState().refresh())
  return () => {
    offQueue()
    offPrefs()
  }
}

export function aiFail(err: unknown): void {
  if (err instanceof RpcError) {
    const known = tr.aiUi.errors[err.code]
    if (known) {
      toast(known)
      return
    }
    toast(err.message)
    return
  }
  toast(tr.errors.generic)
}

/** Vrai si un appel peut partir : fournisseur choisi et consentement donné. */
export function aiReady(provider: string, consentVersion: number | null): boolean {
  return provider !== 'off' && consentVersion !== null
}
