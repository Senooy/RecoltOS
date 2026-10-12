/**
 * Settings › Capture. At the top: title,
 * description, "Global shortcut" (key caps 24×22), help, rule, "Drop folder" (field of
 * 287 pt + "Choose…" / "Clear"), help. Under a second rule: mode,
 * notification, hide the app, clipboard, permission status.
 */
import { CheckCircle2, CircleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { CaptureStatus } from '../../../../shared/dto/capture'
import type { CaptureMode } from '../../../../shared/prefs'
import { Button, SegmentedSmall, Switch, toast } from '../../components/ui'
import { tr } from '../../i18n'
import { labelled } from '../../lib/format'
import { RpcError, rpc } from '../../lib/rpc'
import { usePrefs } from '../../state/prefs'
import { SettingsRow, SettingsTitle } from '../settings/SettingsDialog'
import { ShortcutRecorder } from './ShortcutRecorder'
import './capture.css'

function fail(err: unknown) {
  toast(err instanceof RpcError ? err.message : tr.errors.generic)
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
      <SettingsTitle description={tr.captureUi.desc}>{tr.settings.nav.capture}</SettingsTitle>
      <div className="mt-[9px] text-[11px] text-[var(--set-label)]">
        {tr.settings.capture.shortcut}
      </div>
      <div className="mt-[2px]">
        <ShortcutRecorder />
      </div>
      <div className="capture-rule mt-[18px]" />
      <div className="mt-[18px] text-[11px] text-[var(--set-label)]">
        {tr.settings.capture.dropFolder}
      </div>
      <div className="mt-[5px] flex items-center gap-2.5">
        <input
          readOnly
          data-testid="drop-folder"
          className="capture-field"
          value={cap.dropFolder ?? ''}
          placeholder={tr.captureUi.dropFolderEmpty}
          aria-label={tr.settings.capture.dropFolder}
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
          {tr.settings.capture.choose}
        </Button>
        <Button
          className="h-[33px] px-[14px]"
          data-testid="drop-folder-clear"
          disabled={!cap.dropFolder}
          onClick={() => update({ dropFolder: null, dropFolderInit: true })}
        >
          {tr.settings.capture.clear}
        </Button>
      </div>
      <p className="mt-[10px] max-w-[480px] text-[11px] text-[var(--set-help)]">
        {tr.settings.capture.dropHint}
      </p>
      {status?.lastDropError ? (
        <p className="mt-1 text-[11px] text-danger">
          {tr.captureUi.dropError(status.lastDropError)}
        </p>
      ) : null}

      <div className="capture-rule mt-6" />
      <SettingsRow
        label={tr.captureUi.mode}
        control={
          <SegmentedSmall<CaptureMode>
            label={tr.captureUi.mode}
            value={cap.mode}
            onChange={(mode) => update({ mode })}
            options={(['region', 'window', 'screen'] as const).map((m) => ({
              value: m,
              label: tr.captureUi.modes[m]!,
            }))}
          />
        }
      />
      <SettingsRow
        label={tr.captureUi.notify}
        control={
          <Switch
            aria-label={tr.captureUi.notify}
            checked={cap.notify}
            onCheckedChange={(notify) => update({ notify })}
          />
        }
      />
      <SettingsRow
        label={tr.captureUi.hideApp}
        control={
          <Switch
            aria-label={tr.captureUi.hideApp}
            checked={cap.hideApp}
            onCheckedChange={(hideApp) => update({ hideApp })}
          />
        }
      />
      <SettingsRow
        label={tr.captureUi.copy}
        control={
          <Switch
            aria-label={tr.captureUi.copy}
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
            {labelled(
              tr.captureUi.permission,
              status?.access === 'granted' ? tr.captureUi.granted : tr.captureUi.denied,
            )}
          </span>
        }
        description={status?.access === 'granted' ? tr.captureUi.staleHint : undefined}
        control={
          <div className="flex gap-2">
            {status?.access !== 'granted' ? (
              <Button size="sm" onClick={() => void rpc('capture.openPermissionPane').catch(fail)}>
                {tr.captureUi.openPane}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={refresh}>
              {tr.captureUi.recheck}
            </Button>
          </div>
        }
      />
    </div>
  )
}
