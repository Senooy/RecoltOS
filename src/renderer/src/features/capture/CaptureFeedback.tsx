/**
 * Retours de capture dans la fenêtre : pilule « Capture ajoutée » avec « Voir » et
 * « Annuler » (8 s, met l'élément à la corbeille ; le fichier de dépôt reste), « Déjà dans la
 * bibliothèque » sans annulation ; guide de permission sur `capture.permissionRequired`.
 */
import { useEffect } from 'react'
import { toast } from '../../components/ui'
import { tr } from '../../i18n'
import { rpc, subscribe } from '../../lib/rpc'
import { openViewerByUuid } from '../viewer/open'
import { useCaptureUi } from './capture-actions'
import { PermissionGuide } from './PermissionGuide'

export function CaptureFeedback() {
  const open = useCaptureUi((s) => s.guideOpen)
  const setGuide = useCaptureUi((s) => s.setGuide)
  useEffect(() => {
    const offs = [
      subscribe('capture.done', (r) => {
        if (r.status !== 'ok') {
          if (r.status === 'error') toast(r.message || tr.capture.failed)
          return
        }
        const uuid = r.itemUuid
        if (r.duplicate) {
          toast(tr.capture.duplicate, {
            action: { label: tr.captureUi.view, onClick: () => openViewerByUuid(uuid) },
          })
          return
        }
        toast(tr.capture.done, {
          duration: 8000,
          action: { label: tr.captureUi.view, onClick: () => openViewerByUuid(uuid) },
          cancel: {
            label: tr.captureUi.undo,
            onClick: () => void rpc('items.trash', { uuids: [uuid] }).catch(() => undefined),
          },
        })
      }),
      subscribe('capture.permissionRequired', () => setGuide(true)),
    ]
    return () => offs.forEach((o) => o())
  }, [setGuide])
  return <PermissionGuide open={open} onClose={() => setGuide(false)} />
}
