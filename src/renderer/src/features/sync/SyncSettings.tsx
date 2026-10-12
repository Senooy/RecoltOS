/**
 * Réglages › Synchronisation. En haut : titre, description, libellé de groupe, trois lignes à interrupteur (58 pt), note de bas.
 * Puis : la ligne d'état sous chaque libellé, le lien « En savoir plus », le bouton « … »
 * (visible au survol) et, SOUS la note, la carte « Extension navigateur ».
 */
import { MoreHorizontal } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { EXTENSION_VERSION } from '../../../../shared/bridge/constants'
import type { SyncSourceStatus, SyncStatus } from '../../../../shared/dto/sync'
import { Menu, Popover, Switch, toast } from '../../components/ui'
import { tr } from '../../i18n'
import type { SyncPlatformKey } from '../../i18n/fr/sync'
import { cn } from '../../lib/cn'
import { hourMinute, relative } from '../../lib/format'
import { RpcError, rpc, subscribe } from '../../lib/rpc'
import { usePrefs } from '../../state/prefs'
import { SettingsTitle } from '../settings/SettingsDialog'
import { ActivationSheet, InstallSheet, JournalSheet } from './SyncDialogs'
import './sync.css'

const label = (p: SyncPlatformKey): string => tr.settings.sync[p]

const hhmm = (ts: number): string => hourMinute(ts)

/** Ligne d'état et sa tonalité (gris, ambre, rouge). */
export function statusLine(
  s: SyncSourceStatus,
  now = Date.now(),
): { text: string; tone: 'muted' | 'warn' | 'err' } {
  const p = s.source
  if (!s.enabled) {
    return s.importedFlag
      ? { text: tr.syncUi.line.imported, tone: 'warn' }
      : { text: tr.syncUi.line.disabled, tone: 'muted' }
  }
  if (s.running) {
    const n = s.running.newItems
    return {
      text: s.running.mode === 'backfill' ? tr.syncUi.line.backfill(n) : tr.syncUi.line.running(n),
      tone: 'muted',
    }
  }
  if (s.detail === 'browser_closed') return { text: tr.syncUi.line.browserClosed, tone: 'muted' }
  if (s.detail === 'permissions') return { text: tr.syncUi.line.permissions(p), tone: 'warn' }
  if (s.detail === 'blocked') return { text: tr.syncUi.line.blocked(p), tone: 'err' }
  if (s.detail === 'not_logged_in')
    return { text: tr.syncUi.line.notLoggedIn(p, s.browser), tone: 'warn' }
  switch (s.status) {
    case 'auth_required':
      return { text: tr.syncUi.line.authRequired(p, s.browser), tone: 'warn' }
    case 'rate_limited':
      return s.detail === 'budget'
        ? { text: tr.syncUi.line.budget, tone: 'warn' }
        : {
            text: tr.syncUi.line.rateLimited(s.cooldownUntil ? hhmm(s.cooldownUntil) : null),
            tone: 'warn',
          }
    case 'api_changed':
      return { text: tr.syncUi.line.apiChanged(p), tone: 'err' }
    case 'error':
      return { text: tr.syncUi.line.network, tone: 'warn' }
    case 'waiting_for_tab':
      return { text: tr.syncUi.line.waiting(p), tone: 'muted' }
    case 'no_browser':
      return { text: tr.syncUi.line.browserClosed, tone: 'muted' }
    default:
      break
  }
  if (s.lastSuccessAt)
    return {
      text: tr.syncUi.line.ok(relative(s.lastSuccessAt, now), s.lastNewCount),
      tone: 'muted',
    }
  return { text: tr.syncUi.line.never, tone: 'muted' }
}

function fail(err: unknown) {
  toast(err instanceof RpcError ? err.message : tr.errors.generic)
}

export function useSyncStatus(): [SyncStatus | null, () => void] {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const refresh = useCallback(() => {
    void rpc('sync.getStatus')
      .then(setStatus)
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    refresh()
    const off = subscribe('sync.status', setStatus)
    const t = setInterval(refresh, 30_000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [refresh])
  return [status, refresh]
}

function SourceRow({
  s,
  onToggle,
  onJournal,
  refresh,
}: {
  s: SyncSourceStatus
  onToggle: (on: boolean) => void
  onJournal: () => void
  refresh: () => void
}) {
  const p = s.source
  const line = statusLine(s)
  const id = `sync-label-${p}`
  return (
    <div className="sync-row" data-testid={`sync-row-${p}`}>
      <div className="min-w-0 flex-1">
        <div id={id} className="sync-row-label">
          {label(p)}
        </div>
        <div
          className={cn('sync-row-line', `sync-tone-${line.tone}`)}
          data-testid={`sync-line-${p}`}
        >
          {line.text}
          {p === 'cosmos' && s.enabled ? ` · ${tr.syncUi.experimental}` : ''}
        </div>
      </div>
      <Menu.Dropdown.Root>
        <Menu.Dropdown.Trigger asChild>
          <button
            type="button"
            className="sync-more"
            aria-label={tr.syncUi.menu.open(p)}
            data-testid={`sync-more-${p}`}
          >
            <MoreHorizontal size={16} strokeWidth={1.75} />
          </button>
        </Menu.Dropdown.Trigger>
        <Menu.Dropdown.Content align="end">
          <Menu.Dropdown.Item
            disabled={!s.enabled}
            onSelect={() => void rpc('sync.runNow', { source: s.source }).then(refresh).catch(fail)}
          >
            {tr.syncUi.menu.now}
          </Menu.Dropdown.Item>
          <Menu.Dropdown.Item
            disabled={!s.enabled}
            onSelect={() =>
              void rpc('sync.resyncAll', { source: s.source }).then(refresh).catch(fail)
            }
          >
            {tr.syncUi.menu.resync}
          </Menu.Dropdown.Item>
          <Menu.Dropdown.CheckboxItem
            checked={s.allowBackgroundTab}
            onCheckedChange={(on) =>
              void rpc('sync.setAllowBackgroundTab', { source: s.source, on: on === true })
                .then(refresh)
                .catch(fail)
            }
          >
            {tr.syncUi.menu.backgroundTab}
          </Menu.Dropdown.CheckboxItem>
          <Menu.Dropdown.Item onSelect={onJournal}>{tr.syncUi.menu.journal}</Menu.Dropdown.Item>
        </Menu.Dropdown.Content>
      </Menu.Dropdown.Root>
      <Switch
        aria-labelledby={id}
        data-testid={`sync-switch-${p}`}
        checked={s.enabled}
        onCheckedChange={onToggle}
      />
    </div>
  )
}

function ExtensionCard({ status, onInstall }: { status: SyncStatus; onInstall: () => void }) {
  const browsers = [...new Set(status.clients.map((c) => c.label))]
  const stale = status.clients.find((c) => c.stale)
  const connected = browsers.length > 0
  return (
    <div className="sync-ext" data-testid="sync-extension">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="sync-ext-title">{tr.syncUi.extension.title}</div>
          <div
            className={cn('sync-ext-state', connected ? 'sync-ext-on' : 'sync-ext-off')}
            data-testid="sync-ext-state"
          >
            <i aria-hidden="true" />
            {connected
              ? tr.syncUi.extension.connected(browsers.join(', '))
              : tr.syncUi.extension.missing}
          </div>
        </div>
        <button type="button" className="sync-pill" data-testid="sync-install" onClick={onInstall}>
          {connected ? tr.syncUi.menu.now : tr.syncUi.extension.install}
        </button>
      </div>
      <p className="sync-ext-help">
        {connected ? tr.syncUi.extension.background : tr.syncUi.extension.browserClosed}
      </p>
      <p className="sync-ext-help">{tr.syncUi.extension.supported}</p>
      {stale?.extVersion ? (
        <p className="sync-ext-warn">
          {tr.syncUi.extension.stale(stale.extVersion, EXTENSION_VERSION)}
        </p>
      ) : null}
      {status.gatherosConflict ? (
        <p className="sync-ext-warn" data-testid="sync-gatheros">
          {tr.syncUi.extension.gatheros}
        </p>
      ) : null}
    </div>
  )
}

export function SyncSettings() {
  const [status, refresh] = useSyncStatus()
  const confirmed = usePrefs((s) => s.prefs.sync)
  const [activating, setActivating] = useState<SyncPlatformKey | null>(null)
  const [journal, setJournal] = useState<SyncPlatformKey | null>(null)
  const [install, setInstall] = useState(false)

  const enable = (p: SyncPlatformKey, on: boolean) => {
    if (on && !confirmed[p]) {
      setActivating(p)
      return
    }
    void rpc('sync.setEnabled', { source: p, on })
      .then(() => (on ? rpc('sync.clearImportedFlag', { source: p }) : undefined))
      .then(refresh)
      .catch(fail)
  }

  return (
    <div data-testid="sync-settings">
      <SettingsTitle description={tr.settings.sync.desc}>{tr.settings.nav.sync}</SettingsTitle>
      <div className="sync-group">{tr.settings.sync.group}</div>
      <div>
        {(status?.sources ?? []).map((s) => (
          <SourceRow
            key={s.source}
            s={s}
            refresh={refresh}
            onToggle={(on) => enable(s.source, on)}
            onJournal={() => setJournal(s.source)}
          />
        ))}
      </div>
      <p className="sync-foot">{tr.settings.sync.footnote}</p>
      <p className="sync-foot sync-foot-tight">
        {tr.syncUi.unofficial}{' '}
        <Popover.Root>
          <Popover.Trigger asChild>
            <button type="button" className="sync-link" data-testid="sync-learn-more">
              {tr.syncUi.learnMore}
            </button>
          </Popover.Trigger>
          <Popover.Content className="w-[360px] text-[13px] leading-[18px]">
            {tr.syncUi.learnMoreText}
          </Popover.Content>
        </Popover.Root>
      </p>
      {status ? (
        <ExtensionCard
          status={status}
          onInstall={() =>
            status.browserConnected
              ? void rpc('sync.runNow', {}).then(refresh).catch(fail)
              : setInstall(true)
          }
        />
      ) : null}
      {status && !status.browserConnected ? null : (
        <button
          type="button"
          className="sync-link mt-2 text-[11px]"
          onClick={() => setInstall(true)}
        >
          {tr.syncUi.extension.install}
        </button>
      )}
      {activating ? (
        <ActivationSheet
          platform={activating}
          gatheros={status?.gatherosConflict ?? false}
          onClose={() => setActivating(null)}
          onConfirm={(allowTab) => {
            const p = activating
            setActivating(null)
            void usePrefs
              .getState()
              .update({ sync: { [p]: true } })
              .then(() => rpc('sync.setAllowBackgroundTab', { source: p, on: allowTab }))
              .then(() => rpc('sync.setEnabled', { source: p, on: true }))
              .then(() => rpc('sync.clearImportedFlag', { source: p }))
              .then(refresh)
              .catch(fail)
          }}
        />
      ) : null}
      {journal ? <JournalSheet platform={journal} onClose={() => setJournal(null)} /> : null}
      {install ? <InstallSheet status={status} onClose={() => setInstall(false)} /> : null}
    </div>
  )
}
