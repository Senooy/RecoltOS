/**
 * Notification de capture : référence forte (une `Notification` collectée perd ses
 * écouteurs), clic → fenêtre recréée si besoin puis vue détail (`evt:nav.openItem`) ; `failed`
 * (app non signée, notifications refusées) → repli : fenêtre affichée sans voler le focus + rebond
 * du Dock. Le toast in-app est géré par le renderer (`evt:capture.done`).
 */
import { randomUUID } from 'node:crypto'
import { Notification, app, shell, type BrowserWindow } from 'electron'
import { mt } from '../i18n'

const live = new Map<string, Notification>()

export interface NotifyDeps {
  getMainWindow: () => BrowserWindow | null
  ensureMainWindow: () => Promise<BrowserWindow>
  openItem: (uuid: string) => void
}

function fallback(deps: NotifyDeps): void {
  const w = deps.getMainWindow()
  if (w && !w.isDestroyed() && !w.isVisible()) w.showInactive()
  app.dock?.bounce('informational')
  shell.beep()
}

export function notifyCapture(
  deps: NotifyDeps,
  o: { kind: 'done'; itemUuid: string; duplicate?: boolean } | { kind: 'permission' },
): void {
  if (!Notification.isSupported()) return fallback(deps)
  const id = randomUUID()
  const n = new Notification(
    o.kind === 'permission'
      ? {
          title: mt().notify.permissionTitle,
          body: mt().notify.permissionBody,
          silent: true,
        }
      : {
          title: o.duplicate ? mt().notify.captureDuplicate : mt().notify.captureDone,
          body: mt().notify.captureBody,
          silent: true,
        },
  )
  const drop = () => {
    clearTimeout(timer)
    live.delete(id)
  }
  const timer = setTimeout(drop, 60_000)
  n.on('click', () => {
    drop()
    void deps.ensureMainWindow().then((w) => {
      w.show()
      w.focus()
      if (o.kind === 'done') deps.openItem(o.itemUuid)
    })
  })
  n.on('close', drop)
  n.on('failed', () => {
    drop()
    fallback(deps)
  })
  live.set(id, n)
  n.show()
}
