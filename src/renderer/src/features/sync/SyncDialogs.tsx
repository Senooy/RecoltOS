/**
 * Feuilles de Réglages › Synchronisation (WP-57) : première activation (risques, repli onglet décoché,
 * coexistence GatherOS bloquante pour Instagram), installation de l'extension (Firefox signé ou
 * temporaire, Chromium en mode développeur), journal des 20 derniers runs, revue des publications
 * récupérées par le backfill.
 */
import { useEffect, useState } from 'react'
import type { ItemCard } from '../../../../shared/dto/items'
import type { ExtensionInfo, SyncRunInfo, SyncStatus } from '../../../../shared/dto/sync'
import { Button, Dialog, SegmentedSmall, Spinner, toast } from '../../components/ui'
import { fr } from '../../i18n/fr'
import type { SyncPlatformKey } from '../../i18n/fr/sync'
import { dateShort } from '../../lib/format'
import { mediaSrc } from '../../lib/media-url'
import { RpcError, rpc } from '../../lib/rpc'

const T = fr.syncUi

function fail(err: unknown) {
  toast(err instanceof RpcError ? err.message : fr.errors.generic)
}

export function ActivationSheet({
  platform,
  gatheros,
  onClose,
  onConfirm,
}: {
  platform: SyncPlatformKey
  gatheros: boolean
  onClose: () => void
  onConfirm: (allowBackgroundTab: boolean) => void
}) {
  const [allowTab, setAllowTab] = useState(false)
  const [blocked, setBlocked] = useState(platform === 'instagram' && gatheros)
  const recheck = () =>
    void rpc('bridge.getGatherOSPresence')
      .then((p) => setBlocked(p.blocksInstagram))
      .catch(fail)
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Content
        title={T.activate.title(platform)}
        className="w-[min(460px,calc(100vw-48px))]"
        data-testid="sync-activate"
      >
        <div className="px-5 pb-5 pt-3 text-[13px] leading-[18px]">
          <ul className="sync-bullets">
            <li>{T.activate.risk1(platform)}</li>
            <li>{T.activate.risk2}</li>
            <li>{T.activate.risk3}</li>
          </ul>
          <label className="mt-3 flex items-start gap-2 text-fg-muted">
            <input
              type="checkbox"
              className="mt-[3px]"
              checked={allowTab}
              data-testid="sync-activate-tab"
              onChange={(e) => setAllowTab(e.target.checked)}
            />
            <span>{T.activate.backgroundTab(platform)}</span>
          </label>
          {gatheros ? (
            <p className="sync-ext-warn mt-3" data-testid="sync-activate-gatheros">
              {platform === 'instagram' ? T.activate.gatherosBlock : T.extension.gatheros}
            </p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              {T.activate.cancel}
            </Button>
            {blocked ? (
              <>
                <Button size="sm" onClick={recheck} data-testid="sync-activate-done">
                  {T.activate.done}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => onConfirm(allowTab)}
                  data-testid="sync-activate-anyway"
                >
                  {T.activate.anyway}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="primary"
                onClick={() => onConfirm(allowTab)}
                data-testid="sync-activate-confirm"
              >
                {T.activate.confirm}
              </Button>
            )}
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="sync-step">{n}</span>
      <div className="min-w-0 flex-1 pt-px">{children}</div>
    </li>
  )
}

function CopyAddress({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="sync-link"
      onClick={() =>
        void rpc('system.copyText', { text })
          .then(() => toast(T.install.copied))
          .catch(fail)
      }
    >
      {T.install.copy} <code className="sync-code">{text}</code>
    </button>
  )
}

export function InstallSheet({
  status,
  onClose,
}: {
  status: SyncStatus | null
  onClose: () => void
}) {
  const [tab, setTab] = useState<'firefox' | 'chromium'>('firefox')
  const [info, setInfo] = useState<ExtensionInfo | null>(null)
  useEffect(() => {
    void rpc('bridge.getExtensionInfo')
      .then(setInfo)
      .catch(() => undefined)
  }, [])
  const reveal = (target: 'firefox' | 'chromium') =>
    void rpc('bridge.revealExtensionFolder', { target }).catch(fail)
  const browsers = [...new Set(status?.clients.map((c) => c.label) ?? [])]
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Content
        title={T.install.title}
        className="w-[min(520px,calc(100vw-48px))]"
        data-testid="sync-install-sheet"
      >
        <div className="px-5 pb-5 pt-3 text-[13px] leading-[18px]">
          <SegmentedSmall
            label={T.install.title}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'firefox', label: T.install.firefox },
              { value: 'chromium', label: T.install.chromium },
            ]}
          />
          {tab === 'firefox' ? (
            <div className="mt-3 space-y-3">
              <div>
                <div className="font-medium">{T.install.ffSignedTitle}</div>
                {info?.firefoxXpi ? (
                  <ol className="mt-1.5 space-y-1.5">
                    <Step n={1}>
                      {T.install.ffSigned1}{' '}
                      <button type="button" className="sync-link" onClick={() => reveal('firefox')}>
                        {T.extension.revealXpi}
                      </button>
                    </Step>
                    <Step n={2}>{T.install.ffSigned2}</Step>
                  </ol>
                ) : (
                  <p className="mt-1 text-fg-muted">{T.install.ffNoSigned}</p>
                )}
              </div>
              <div>
                <div className="font-medium">{T.install.ffTempTitle}</div>
                <ol className="mt-1.5 space-y-1.5">
                  <Step n={1}>
                    {T.install.ffTemp1}
                    <div>
                      <CopyAddress text="about:debugging#/runtime/this-firefox" />
                    </div>
                  </Step>
                  <Step n={2}>{T.install.ffTemp2}</Step>
                  <Step n={3}>
                    {T.install.ffTemp3}{' '}
                    <button type="button" className="sync-link" onClick={() => reveal('firefox')}>
                      {T.extension.reveal}
                    </button>
                  </Step>
                </ol>
              </div>
            </div>
          ) : (
            <ol className="mt-3 space-y-1.5">
              <Step n={1}>
                {T.install.cr1}
                <div>
                  <CopyAddress text="chrome://extensions" />
                </div>
              </Step>
              <Step n={2}>{T.install.cr2}</Step>
              <Step n={3}>
                {T.install.cr3}{' '}
                <button type="button" className="sync-link" onClick={() => reveal('chromium')}>
                  {T.extension.reveal}
                </button>
              </Step>
            </ol>
          )}
          <div className="mt-4 flex items-center justify-between gap-3">
            <span
              className={
                browsers.length ? 'sync-ext-state sync-ext-on' : 'sync-ext-state sync-ext-off'
              }
              data-testid="sync-install-state"
            >
              <i aria-hidden="true" />
              {browsers.length ? T.install.done(browsers.join(', ')) : T.install.waiting}
            </span>
            <Button size="sm" variant="primary" onClick={onClose}>
              {T.install.close}
            </Button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  )
}

export function JournalSheet({
  platform,
  onClose,
}: {
  platform: SyncPlatformKey
  onClose: () => void
}) {
  const [runs, setRuns] = useState<SyncRunInfo[] | null>(null)
  useEffect(() => {
    void rpc('sync.getRuns', { source: platform, limit: 20 })
      .then(setRuns)
      .catch(() => setRuns([]))
  }, [platform])
  const j = T.journal
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Content
        title={j.title(platform)}
        className="w-[min(560px,calc(100vw-48px))]"
        data-testid="sync-journal"
      >
        <div className="max-h-[60vh] overflow-y-auto px-5 pb-5 pt-3 text-[12.5px]">
          {!runs ? <Spinner /> : null}
          {runs && runs.length === 0 ? <p className="text-fg-muted">{j.empty}</p> : null}
          {runs && runs.length > 0 ? (
            <table className="w-full border-collapse">
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-border-subtle">
                    <td className="py-1.5 pr-2 text-fg-muted">{dateShort(r.startedAt)}</td>
                    <td className="py-1.5 pr-2">
                      {j.modes[r.mode] ?? r.mode} · {j.reasons[r.reason] ?? r.reason}
                    </td>
                    <td className="py-1.5 pr-2 text-fg-muted">
                      {r.browser ?? '—'} · {r.target ? (j.targets[r.target] ?? r.target) : '—'}
                    </td>
                    <td className="py-1.5 pr-2">{j.line(r.pages, r.newItems)}</td>
                    <td className="py-1.5 text-fg-muted">{r.status ?? '…'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  )
}

export function RecoveredDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<ItemCard[] | null>(null)
  useEffect(() => {
    void rpc('sync.recovered', {})
      .then((r) => setItems(r.items))
      .catch(() => setItems([]))
  }, [])
  const r = T.review
  const done = () => void rpc('sync.ackRecovered', {}).then(onClose).catch(fail)
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Content
        title={r.title}
        description={r.description}
        className="w-[min(720px,calc(100vw-48px))]"
        data-testid="sync-recovered"
      >
        <div className="max-h-[60vh] overflow-y-auto px-5 pt-3">
          {!items ? <Spinner /> : null}
          <div className="grid grid-cols-5 gap-2">
            {(items ?? []).map((c) => {
              const src = mediaSrc(c.thumbUrl ?? c.posterUrl)
              return (
                <div key={c.uuid} className="aspect-square overflow-hidden rounded-md bg-surface">
                  {src ? (
                    <img src={src} alt={c.title ?? ''} className="h-full w-full object-cover" />
                  ) : (
                    <div className="p-2 text-[11px] leading-[14px] text-fg-muted">
                      {c.post?.text?.slice(0, 140) ?? c.title ?? ''}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 pb-5 pt-4">
          <Button
            size="sm"
            variant="danger"
            disabled={!items?.length}
            onClick={() => {
              const uuids = (items ?? []).map((c) => c.uuid)
              void rpc('items.trash', { uuids })
                .then(({ count }) => {
                  toast(r.trashed(count))
                  done()
                })
                .catch(fail)
            }}
          >
            {r.trash}
          </Button>
          <Button size="sm" variant="primary" onClick={done}>
            {r.keep}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  )
}
