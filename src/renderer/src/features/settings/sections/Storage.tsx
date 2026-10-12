/**
 * Settings › Storage: 8 px stacked bar (Images, Videos, Previews,
 * Snapshots, in 4 greys) with legend, "Download remote media", "Empty trash"
 * automatically", "Regenerate previews", "Empty trash now".
 * "Keep originals" is not offered: RecoltOS always keeps the originals.
 */
import { useCallback, useEffect, useState } from 'react'
import type { z } from 'zod'
import type { StorageBreakdown } from '../../../../../shared/ipc/data'
import { Button, Switch, toast } from '../../../components/ui'
import { tr } from '../../../i18n'
import { bytes, labelled } from '../../../lib/format'
import { RpcError, rpc, subscribe } from '../../../lib/rpc'
import { askConfirm } from '../../../state/dialogs'
import { usePrefs } from '../../../state/prefs'
import { SettingsRow, SettingsTitle } from '../SettingsDialog'

type Storage = z.output<typeof StorageBreakdown>

// Greys of the usage bar: per-theme tokens (`tokens.css`, --set-storage-1…4).
const GREYS = [
  'var(--set-storage-1)',
  'var(--set-storage-2)',
  'var(--set-storage-3)',
  'var(--set-storage-4)',
]

function fail(err: unknown) {
  toast(err instanceof RpcError ? err.message : tr.errors.generic)
}

export function StorageSection() {
  const prefs = usePrefs((s) => s.prefs)
  const [sizes, setSizes] = useState<Storage | null>(null)
  const [trash, setTrash] = useState(0)
  const load = useCallback(() => {
    void rpc('data.storage')
      .then(setSizes)
      .catch(() => undefined)
    void rpc('items.counts')
      .then((c) => setTrash(c.trash))
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    load()
    const offs = [subscribe('items.changed', load), subscribe('library.switched', load)]
    return () => offs.forEach((o) => o())
  }, [load])
  const update = (patch: Parameters<ReturnType<typeof usePrefs.getState>['update']>[0]) =>
    void usePrefs.getState().update(patch).catch(fail)

  const parts = sizes
    ? [
        { label: tr.settings.storage.images, value: sizes.images },
        { label: tr.settings.storage.videos, value: sizes.videos },
        {
          label: tr.settings.storage.derived,
          value: sizes.thumbs + sizes.large + sizes.posters + sizes.previews + sizes.display,
        },
        { label: tr.settings.storage.snapshots, value: sizes.snapshots },
      ]
    : []
  const sum = Math.max(1, sizes?.total ?? 1)

  const regenerate = async () => {
    try {
      const r = await rpc('data.regenerateDerived')
      toast(tr.settingsMoreUi.regenStarted(r.count))
    } catch (err) {
      fail(err)
    }
  }
  const emptyTrash = async () => {
    const ok = await askConfirm({
      title: tr.confirm.emptyTrashTitle,
      body: tr.confirm.emptyTrashBody(trash),
      confirmLabel: tr.tabs.emptyTrash,
      danger: true,
    })
    if (!ok) return
    try {
      await rpc('items.emptyTrash')
      load()
    } catch (err) {
      fail(err)
    }
  }

  return (
    <>
      <SettingsTitle description={tr.settingsMoreUi.storageDesc}>
        {tr.settings.nav.storage}
      </SettingsTitle>
      <div className="mt-5" data-testid="storage-bar">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]">
          {parts.map((p, i) => (
            <div
              key={p.label}
              style={{ width: `${(p.value / sum) * 100}%`, background: GREYS[i] }}
              title={labelled(p.label, bytes(p.value))}
            />
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-muted">
          {parts.map((p, i) => (
            <span key={p.label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: GREYS[i] }} />
              {p.label}
              <span className="text-[var(--set-help)] tnum">{bytes(p.value)}</span>
            </span>
          ))}
          {sizes ? (
            <span className="ml-auto text-[var(--set-help)] tnum">
              {tr.settingsMoreUi.storageTotal(bytes(sizes.total))}
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-3">
        <SettingsRow
          label={tr.settings.storage.downloadRemote}
          description={tr.settingsMoreUi.downloadRemoteDesc}
          control={
            <Switch
              aria-label={tr.settings.storage.downloadRemote}
              data-testid="pref-download-remote"
              checked={prefs.storage.downloadRemoteMedia}
              onCheckedChange={(downloadRemoteMedia) =>
                update({ storage: { downloadRemoteMedia } })
              }
            />
          }
        />
        <SettingsRow
          label={tr.settings.storage.autoEmpty}
          description={tr.settingsMoreUi.autoEmptyDesc}
          control={
            <select
              aria-label={tr.settings.storage.autoEmpty}
              className="h-[34px] rounded-[10px] border border-[var(--set-field-border)] bg-[var(--set-field-bg)] px-3 text-[12.5px]"
              value={prefs.trashAutoEmptyDays}
              onChange={(e) =>
                update({ trashAutoEmptyDays: Number(e.target.value) as 0 | 7 | 30 | 90 })
              }
            >
              <option value={0}>{tr.settings.storage.never}</option>
              {[7, 30, 90].map((d) => (
                <option key={d} value={d}>
                  {tr.settings.storage.days(d)}
                </option>
              ))}
            </select>
          }
        />
        <SettingsRow
          label={tr.settings.storage.regenDerived}
          description={tr.settingsMoreUi.regenDesc}
          control={
            <Button variant="secondary" onClick={() => void regenerate()}>
              {tr.settingsMoreUi.regenAction}
            </Button>
          }
        />
        <SettingsRow
          label={tr.settings.storage.emptyNow}
          description={tr.settingsMoreUi.emptyNowDesc(trash)}
          control={
            <Button variant="danger" disabled={trash === 0} onClick={() => void emptyTrash()}>
              {tr.settingsMoreUi.emptyAction}
            </Button>
          }
        />
      </div>
    </>
  )
}
