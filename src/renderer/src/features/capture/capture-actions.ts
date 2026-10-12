/**
 * Capture actions on the renderer side: start (`capture.run`), feedback (`evt:capture.done`), permission
 * guide (`evt:capture.permissionRequired`).
 */
import { create } from 'zustand'
import { toast } from '../../components/ui'
import { tr } from '../../i18n'
import { RpcError, rpc } from '../../lib/rpc'
import { useUi } from '../../state/ui'

export const useCaptureUi = create<{ guideOpen: boolean; setGuide: (o: boolean) => void }>()(
  (set) => ({ guideOpen: false, setGuide: (guideOpen) => set({ guideOpen }) }),
)

/** Capture from the menu, the FAB or the palette (open collection = destination). */
export async function runCapture(): Promise<void> {
  const route = useUi.getState().route
  try {
    const r = await rpc(
      'capture.run',
      route.name === 'collection' ? { collectionUuid: route.uuid } : {},
    )
    if (r.status === 'busy') toast(tr.capture.busy)
    else if (r.status === 'error') toast(r.message || tr.capture.failed)
  } catch (err) {
    toast(err instanceof RpcError ? err.message : tr.capture.failed)
  }
}
