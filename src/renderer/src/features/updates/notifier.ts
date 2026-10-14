/**
 * Update ready: discreet persistent pill « RecoltOS x.y.z is ready · Restart ». Wired once at the
 * root (`App.tsx`); also shown at mount if the update was downloaded before the window opened.
 * Without a restart, main installs it when the app quits.
 */
import type { UpdateStatus } from '../../../../shared/ipc/updates'
import { toast } from '../../components/ui'
import { tr } from '../../i18n'
import { rpc, subscribe } from '../../lib/rpc'

export const UPDATE_TOAST_ID = 'update-ready'

export function restartToUpdate(): void {
  void rpc('updates.install').catch(() => undefined)
}

export function installUpdateNotifier(): () => void {
  let shownFor: string | null = null
  const show = (s: UpdateStatus) => {
    if (s.status.state !== 'ready' || shownFor === s.status.version) return
    shownFor = s.status.version
    toast(tr.updatesUi.toast.ready(s.status.version), {
      id: UPDATE_TOAST_ID,
      duration: Infinity,
      action: { label: tr.updatesUi.toast.restart, onClick: restartToUpdate },
    })
  }
  let live = true
  void rpc('updates.getStatus')
    .then((s) => live && show(s))
    .catch(() => undefined)
  const off = subscribe('updates.status', show)
  return () => {
    live = false
    off()
  }
}
