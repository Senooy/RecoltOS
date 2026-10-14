/**
 * Settings › About › Updates: current version, state (up to date / downloading x % / ready ·
 * Restart / error), "Check for Updates" and the automatic check switch (`updates.auto`).
 * Everything goes through main (`updates.*`): the renderer never touches the network.
 */
import { useState } from 'react'
import type { UpdateStatus } from '../../../../shared/ipc/updates'
import { Button, Switch } from '../../components/ui'
import { tr } from '../../i18n'
import { rpc } from '../../lib/rpc'
import { usePrefs } from '../../state/prefs'
import { SettingsRow } from '../settings/SettingsDialog'
import { restartToUpdate } from './notifier'
import { useUpdateStatus } from './use-update-status'

export function updateStateLabel(s: UpdateStatus['status']): string {
  const t = tr.updatesUi.state
  switch (s.state) {
    case 'unsupported':
      return t.unsupported
    case 'idle':
      return t.idle
    case 'checking':
      return t.checking
    case 'upToDate':
      return t.upToDate
    case 'downloading':
      return t.downloading(s.version, s.percent)
    case 'ready':
      return t.ready(s.version)
    case 'error':
      return t.error
  }
}

export function UpdatesBlock() {
  const auto = usePrefs((s) => s.prefs.updates.auto)
  const [status, setStatus] = useUpdateStatus()
  const [busy, setBusy] = useState(false)
  const state = status?.status
  const unsupported = !state || state.state === 'unsupported'
  const working = busy || state?.state === 'checking' || state?.state === 'downloading'

  const check = async () => {
    setBusy(true)
    try {
      setStatus(await rpc('updates.check'))
    } catch {
      // State unchanged: main logs the cause.
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full max-w-[470px]" data-testid="about-updates">
      <div className="text-[13px] font-semibold">{tr.updatesUi.title}</div>
      <SettingsRow
        label={status ? tr.updatesUi.current(status.currentVersion) : tr.updatesUi.title}
        description={
          <span
            data-testid="updates-state"
            role="status"
            title={state?.state === 'error' ? state.message : undefined}
          >
            {state ? updateStateLabel(state) : tr.updatesUi.state.unsupported}
          </span>
        }
        control={
          state?.state === 'ready' ? (
            <Button variant="primary" data-testid="updates-restart" onClick={restartToUpdate}>
              {tr.updatesUi.restart}
            </Button>
          ) : (
            <Button
              variant="secondary"
              data-testid="updates-check"
              disabled={unsupported || working}
              onClick={() => void check()}
            >
              {tr.updatesUi.check}
            </Button>
          )
        }
      />
      <SettingsRow
        label={tr.updatesUi.auto}
        description={tr.updatesUi.autoDesc}
        control={
          <Switch
            aria-label={tr.updatesUi.auto}
            data-testid="pref-updates-auto"
            checked={auto}
            onCheckedChange={(on) =>
              void usePrefs
                .getState()
                .update({ updates: { auto: on } })
                .catch(() => undefined)
            }
          />
        }
      />
    </div>
  )
}
