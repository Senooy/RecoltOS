/**
 * Settings › Data: zip export (progress), snapshots (creation,
 * list, "Restore…" with confirmation), GatherOS import, data folder, verification.
 */
import { useCallback, useEffect, useState } from 'react'
import type { SnapshotInfo } from '../../../../../shared/ipc/data'
import { Button, Spinner, toast } from '../../../components/ui'
import { tr } from '../../../i18n'
import { bytes, dateShort, intlLocale, labelled } from '../../../lib/format'
import { RpcError, rpc, subscribe } from '../../../lib/rpc'
import { createSnapshot, exportZip } from '../../../shell/commands'
import { askConfirm } from '../../../state/dialogs'
import { useUi } from '../../../state/ui'
import { SettingsRow, SettingsTitle } from '../SettingsDialog'

function fail(err: unknown) {
  toast(err instanceof RpcError ? err.message : tr.errors.generic)
}

function reasonLabel(reason: string | null): string {
  if (!reason || reason === 'manual') return tr.settingsMoreUi.reasons.manual!
  const v = /^pre-v(\d+)$/.exec(reason)
  if (v) return tr.settingsMoreUi.reasonPreMigration(v[1]!)
  return tr.settingsMoreUi.reasons[reason] ?? reason
}

function time(at: number): string {
  return new Date(at).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })
}

export function DataSection() {
  const openOverlay = useUi((s) => s.openOverlay)
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([])
  const [progress, setProgress] = useState<{ bytesDone: number; bytesTotal: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(() => {
    void rpc('data.snapshot.list')
      .then(setSnapshots)
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    load()
    const offs = [
      subscribe('library.switched', load),
      subscribe('export.progress', (p) => setProgress(p.bytesDone >= p.bytesTotal ? null : p)),
    ]
    return () => offs.forEach((o) => o())
  }, [load])

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }
  const restore = async (s: SnapshotInfo) => {
    const ok = await askConfirm({
      title: tr.settingsMoreUi.restoreTitle,
      body: `${dateShort(s.createdAt)} ${time(s.createdAt)} — ${tr.settingsMoreUi.restoreBody}`,
      confirmLabel: tr.settingsMoreUi.restoreConfirm,
      danger: true,
    })
    if (!ok) return
    await run(s.name, async () => {
      try {
        await rpc('data.snapshot.restore', { name: s.name })
        toast(tr.settingsMoreUi.restoreDone)
        load()
      } catch (err) {
        fail(err)
      }
    })
  }
  const reveal = async () => {
    try {
      const r = await rpc('libraries.list')
      await rpc('libraries.reveal', { id: r.active })
    } catch (err) {
      fail(err)
    }
  }
  const verify = async () => {
    try {
      const r = await rpc('data.verify')
      toast(
        r.ok
          ? tr.settingsMoreUi.verifyOk
          : labelled(
              tr.settingsMoreUi.verifyIssues(r.issues.length),
              r.issues.map((i) => `${i.message} (${i.count})`).join(', '),
            ),
      )
    } catch (err) {
      fail(err)
    }
  }

  return (
    <>
      <SettingsTitle description={tr.settingsMoreUi.dataDesc}>{tr.settings.nav.data}</SettingsTitle>
      <div className="mt-4">
        <SettingsRow
          label={tr.settings.data.export}
          description={
            progress
              ? tr.settingsMoreUi.exportProgress(
                  bytes(progress.bytesDone),
                  bytes(progress.bytesTotal),
                )
              : tr.settingsMoreUi.exportDesc
          }
          control={
            <Button
              variant="secondary"
              data-testid="data-export"
              disabled={busy === 'export'}
              onClick={() => void run('export', () => exportZip())}
            >
              {busy === 'export' ? <Spinner size={14} /> : tr.settingsMoreUi.exportAction}
            </Button>
          }
        />
        <SettingsRow
          label={tr.settings.data.snapshot}
          description={tr.settingsMoreUi.snapshotDesc}
          control={
            <Button
              variant="secondary"
              data-testid="data-snapshot"
              onClick={() =>
                void run('snapshot', async () => {
                  await createSnapshot()
                  load()
                })
              }
            >
              {tr.settingsMoreUi.snapshotAction}
            </Button>
          }
        />
        <div className="mt-[18px] text-[11px] text-[var(--set-label)]">
          {tr.settingsMoreUi.snapshotsGroup}
        </div>
        <div className="mt-1.5 overflow-hidden rounded-[10px] border border-[var(--set-rule)]">
          {snapshots.length === 0 ? (
            <p className="px-4 py-3 text-[11.5px] text-fg-faint">
              {tr.settingsMoreUi.snapshotsEmpty}
            </p>
          ) : (
            snapshots.slice(0, 50).map((s) => (
              <div
                key={s.name}
                data-testid="snapshot-row"
                data-name={s.name}
                className="flex h-11 items-center gap-3 border-b border-[var(--set-rule)] px-4 last:border-b-0"
              >
                <span className="text-[12px] text-fg tnum">
                  {dateShort(s.createdAt)} {time(s.createdAt)}
                </span>
                <span className="text-[11px] text-[var(--set-help)]">{reasonLabel(s.reason)}</span>
                <span className="ml-auto text-[11px] text-[var(--set-help)] tnum">
                  {bytes(s.bytes)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="snapshot-restore"
                  disabled={busy !== null}
                  onClick={() => void restore(s)}
                >
                  {busy === s.name ? <Spinner size={14} /> : tr.settings.data.restore}
                </Button>
              </div>
            ))
          )}
        </div>
        <SettingsRow
          label={tr.settings.data.import}
          description={tr.settingsMoreUi.importDesc}
          control={
            <Button
              variant="secondary"
              onClick={() => openOverlay({ type: 'settings', section: 'libraries' })}
            >
              {tr.settingsMoreUi.importAction}
            </Button>
          }
        />
        <SettingsRow
          label={tr.settings.data.openFolder}
          description={tr.settingsMoreUi.openFolderDesc}
          control={
            <Button variant="secondary" onClick={() => void reveal()}>
              {tr.settingsMoreUi.openFolderAction}
            </Button>
          }
        />
        <SettingsRow
          label={tr.settingsMoreUi.verifyAction}
          control={
            <Button variant="secondary" onClick={() => void verify()}>
              {tr.settings.ai.check}
            </Button>
          }
        />
      </div>
    </>
  )
}
