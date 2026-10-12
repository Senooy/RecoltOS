/**
 * Réglages › Capture (DESIGN §3.10, SPACES §2.6). Partie haute fidèle à `kgogfx` : titre,
 * description, « Raccourci global » (key caps 24×22), aide, filet, « Dossier de dépôt » (champ de
 * 287 pt + « Choisir… » / « Effacer »), aide. Sous un second filet (ajouts RecoltOS) : mode,
 * notification, masquer l'app, presse-papiers, état de la permission.
 */
import { CheckCircle2, CircleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { CaptureStatus } from '../../../../shared/dto/capture'
import type { CaptureMode } from '../../../../shared/prefs'
import { Button, SegmentedSmall, Switch, toast } from '../../components/ui'
import { fr } from '../../i18n/fr'
import { RpcError, rpc } from '../../lib/rpc'
import { usePrefs } from '../../state/prefs'
import { SettingsRow, SettingsTitle } from '../settings/SettingsDialog'
import { ShortcutRecorder } from './ShortcutRecorder'
import './capture.css'

function fail(err: unknown) {
  toast(err instanceof RpcError ? err.message : fr.errors.generic)
}

export function CaptureSettings() {
  const cap = usePrefs((s) => s.prefs.capture)
  const [status, setStatus] = useState<CaptureStatus | null>(null)
  const refresh = useCallback(() => {
    void rpc('capture.status')
      .then(setStatus)
      .catch(() => undefined)
  }, [])
  useEffect(refresh, [refresh])
  const update = (patch: Partial<typeof cap>) =>
    void usePrefs.getState().update({ capture: patch }).catch(fail)

  return (
    <div data-testid="capture-settings">
      <SettingsTitle description={fr.captureUi.desc}>{fr.settings.nav.capture}</SettingsTitle>
      <div className="mt-[9px] text-[11px] text-[var(--set-label)]">
        {fr.settings.capture.shortcut}
      </div>
      <div className="mt-[2px]">
        <ShortcutRecorder />
      </div>
      <div className="capture-rule mt-[18px]" />
      <div className="mt-[18px] text-[11px] text-[var(--set-label)]">
        {fr.settings.capture.dropFolder}
      </div>
      <div className="mt-[5px] flex items-center gap-2.5">
        <input
          readOnly
          data-testid="drop-folder"
          className="capture-field"
          value={cap.dropFolder ?? ''}
          placeholder={fr.captureUi.dropFolderEmpty}
          aria-label={fr.settings.capture.dropFolder}
        />
        <Button
          className="h-[33px] px-[14px]"
          data-testid="drop-folder-choose"
          onClick={() =>
            void rpc('capture.pickDropFolder')
              .then(() => usePrefs.getState().load())
              .catch(fail)
          }
        >
          {fr.settings.capture.choose}
        </Button>
        <Button
          className="h-[33px] px-[14px]"
          data-testid="drop-folder-clear"
          disabled={!cap.dropFolder}
          onClick={() => update({ dropFolder: null, dropFolderInit: true })}
        >
          {fr.settings.capture.clear}
        </Button>
      </div>
      <p className="mt-[10px] max-w-[480px] text-[11px] text-[var(--set-help)]">
        {fr.settings.capture.dropHint}
      </p>
      {status?.lastDropError ? (
        <p className="mt-1 text-[11px] text-danger">
          {fr.captureUi.dropError(status.lastDropError)}
        </p>
      ) : null}

      <div className="capture-rule mt-6" />
      <SettingsRow
        label={fr.captureUi.mode}
        control={
          <SegmentedSmall<CaptureMode>
            label={fr.captureUi.mode}
            value={cap.mode}
            onChange={(mode) => update({ mode })}
            options={(['region', 'window', 'screen'] as const).map((m) => ({
              value: m,
              label: fr.captureUi.modes[m]!,
            }))}
          />
        }
      />
      <SettingsRow
        label={fr.captureUi.notify}
        control={
          <Switch
            aria-label={fr.captureUi.notify}
            checked={cap.notify}
            onCheckedChange={(notify) => update({ notify })}
          />
        }
      />
      <SettingsRow
        label={fr.captureUi.hideApp}
        control={
          <Switch
            aria-label={fr.captureUi.hideApp}
            checked={cap.hideApp}
            onCheckedChange={(hideApp) => update({ hideApp })}
          />
        }
      />
      <SettingsRow
        label={fr.captureUi.copy}
        control={
          <Switch
            aria-label={fr.captureUi.copy}
            checked={cap.copyToClipboard}
            onCheckedChange={(copyToClipboard) => update({ copyToClipboard })}
          />
        }
      />
      <SettingsRow
        label={
          <span className="flex items-center gap-2" data-testid="permission-status">
            {status?.access === 'granted' ? (
              <CheckCircle2 size={15} className="text-[var(--tone-ok)]" />
            ) : (
              <CircleAlert size={15} className="text-[var(--tone-caution)]" />
            )}
            {fr.captureUi.permission} :{' '}
            {status?.access === 'granted' ? fr.captureUi.granted : fr.captureUi.denied}
          </span>
        }
        description={status?.access === 'granted' ? fr.captureUi.staleHint : undefined}
        control={
          <div className="flex gap-2">
            {status?.access !== 'granted' ? (
              <Button size="sm" onClick={() => void rpc('capture.openPermissionPane').catch(fail)}>
                {fr.captureUi.openPane}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={refresh}>
              {fr.captureUi.recheck}
            </Button>
          </div>
        }
      />
    </div>
  )
}
