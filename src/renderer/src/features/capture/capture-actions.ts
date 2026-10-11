/**
 * Actions de capture côté renderer : lancer (`capture.run`), retours (`evt:capture.done`), guide
 * de permission (`evt:capture.permissionRequired`).
 */
import { create } from 'zustand'
import { toast } from '../../components/ui'
import { fr } from '../../i18n/fr'
import { RpcError, rpc } from '../../lib/rpc'
import { useUi } from '../../state/ui'

export const useCaptureUi = create<{ guideOpen: boolean; setGuide: (o: boolean) => void }>()(
  (set) => ({ guideOpen: false, setGuide: (guideOpen) => set({ guideOpen }) }),
)

/** Capture depuis le menu, le FAB ou la palette (collection ouverte = destination). */
export async function runCapture(): Promise<void> {
  const route = useUi.getState().route
  try {
    const r = await rpc(
      'capture.run',
      route.name === 'collection' ? { collectionUuid: route.uuid } : {},
    )
    if (r.status === 'busy') toast(fr.capture.busy)
    else if (r.status === 'error') toast(r.message || fr.capture.failed)
  } catch (err) {
    toast(err instanceof RpcError ? err.message : fr.capture.failed)
  }
}
