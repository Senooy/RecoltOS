/**
 * Guide « Enregistrement de l'écran » : modale du style Réglages, 3 étapes
 * (Réglages Système, activer RecoltOS — « Electron (ou ton terminal) » en développement —, relancer).
 * « Relancer » toujours proposé ; sondage chaque seconde : coche verte et « Réessayer la capture »
 * quand l'accès devient `granted`. Signature ad hoc signalée.
 */
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CaptureStatus } from '../../../../shared/dto/capture'
import { Button, Dialog } from '../../components/ui'
import { fr } from '../../i18n/fr'
import { rpc } from '../../lib/rpc'
import { runCapture } from './capture-actions'

export function PermissionGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<CaptureStatus | null>(null)
  useEffect(() => {
    if (!open) return
    let alive = true
    const poll = () =>
      void rpc('capture.status')
        .then((s) => alive && setStatus(s))
        .catch(() => undefined)
    poll()
    const t = setInterval(poll, 1000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [open])
  const granted = status?.access === 'granted'
  const dev = status?.signature === 'dev'
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Content
        data-testid="permission-guide"
        title={fr.captureUi.guideTitle}
        className="w-[440px]"
      >
        <p className="text-[12px] leading-[19.5px] text-fg-muted">{fr.captureUi.guideBody}</p>
        <ol className="mt-4 space-y-3 text-[12px]">
          <li className="flex items-center gap-3">
            <span className="capture-step">1</span>
            <span className="flex-1">{fr.captureUi.guideStep1}</span>
            <Button size="sm" onClick={() => void rpc('capture.openPermissionPane')}>
              {fr.captureUi.openPane}
            </Button>
          </li>
          <li className="flex items-center gap-3">
            <span className="capture-step">2</span>
            <span className="flex-1">{fr.captureUi.guideStep2(dev)}</span>
            {granted ? (
              <span
                className="flex items-center gap-1 text-[11px] text-[var(--tone-ok)]"
                data-testid="permission-granted"
              >
                <Check size={14} strokeWidth={2.5} /> {fr.captureUi.guideGranted}
              </span>
            ) : null}
          </li>
          <li className="flex items-center gap-3">
            <span className="capture-step">3</span>
            <span className="flex-1">{fr.captureUi.guideStep3}</span>
            <Button
              size="sm"
              variant={granted ? 'secondary' : 'primary'}
              onClick={() => void rpc('capture.relaunch')}
            >
              {fr.capture.relaunch}
            </Button>
          </li>
        </ol>
        {status?.signature === 'adhoc' ? (
          <p className="mt-4 rounded-[10px] border border-[var(--set-box-border)] bg-[var(--surface-info)] px-4 py-3 text-[11px] text-fg-muted">
            {fr.captureUi.guideAdhoc}
          </p>
        ) : null}
        {granted ? (
          <div className="mt-5 flex justify-end">
            <Button
              variant="primary"
              onClick={() => {
                onClose()
                void runCapture()
              }}
            >
              {fr.captureUi.retry}
            </Button>
          </div>
        ) : null}
      </Dialog.Content>
    </Dialog.Root>
  )
}
