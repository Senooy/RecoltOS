/**
 * Réglages › Données (DESIGN §3.10, ARCHI §7) : export zip (progression), instantanés (création,
 * liste, « Restaurer… » avec confirmation), import GatherOS, dossier des données, vérification.
 */
import { useCallback, useEffect, useState } from 'react'
import type { SnapshotInfo } from '../../../../../shared/ipc/data'
import { Button, Spinner, toast } from '../../../components/ui'
import { fr } from '../../../i18n/fr'
import { bytes, dateShort } from '../../../lib/format'
import { RpcError, rpc, subscribe } from '../../../lib/rpc'
import { createSnapshot, exportZip } from '../../../shell/commands'
import { askConfirm } from '../../../state/dialogs'
import { useUi } from '../../../state/ui'
import { SettingsRow, SettingsTitle } from '../SettingsDialog'

function fail(err: unknown) {
  toast(err instanceof RpcError ? err.message : fr.errors.generic)
}

function reasonLabel(reason: string | null): string {
  if (!reason || reason === 'manual') return fr.settingsMoreUi.reasons.manual!
  const v = /^pre-v(\d+)$/.exec(reason)
  if (v) return fr.settingsMoreUi.reasonPreMigration(v[1]!)
  return fr.settingsMoreUi.reasons[reason] ?? reason
}

function time(at: number): string {
  return new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
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
      title: fr.settingsMoreUi.restoreTitle,
      body: `${dateShort(s.createdAt)} ${time(s.createdAt)} — ${fr.settingsMoreUi.restoreBody}`,
      confirmLabel: fr.settingsMoreUi.restoreConfirm,
      danger: true,
    })
    if (!ok) return
    await run(s.name, async () => {
      try {
        await rpc('data.snapshot.restore', { name: s.name })
        toast(fr.settingsMoreUi.restoreDone)
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
          ? fr.settingsMoreUi.verifyOk
          : `${fr.settingsMoreUi.verifyIssues(r.issues.length)} : ${r.issues
              .map((i) => `${i.message} (${i.count})`)
              .join(', ')}`,
      )
    } catch (err) {
      fail(err)
    }
  }

  return (
    <>
      <SettingsTitle description={fr.settingsMoreUi.dataDesc}>{fr.settings.nav.data}</SettingsTitle>
      <div className="mt-4">
        <SettingsRow
          label={fr.settings.data.export}
          description={
            progress
              ? fr.settingsMoreUi.exportProgress(
                  bytes(progress.bytesDone),
                  bytes(progress.bytesTotal),
                )
              : fr.settingsMoreUi.exportDesc
          }
          control={
            <Button
              variant="secondary"
              data-testid="data-export"
              disabled={busy === 'export'}
              onClick={() => void run('export', () => exportZip())}
            >
              {busy === 'export' ? <Spinner size={14} /> : fr.settingsMoreUi.exportAction}
            </Button>
          }
        />
        <SettingsRow
          label={fr.settings.data.snapshot}
          description={fr.settingsMoreUi.snapshotDesc}
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
              {fr.settingsMoreUi.snapshotAction}
            </Button>
          }
        />
        <div className="mt-[18px] text-[11px] text-[var(--set-label)]">
          {fr.settingsMoreUi.snapshotsGroup}
        </div>
        <div className="mt-1.5 overflow-hidden rounded-[10px] border border-[var(--set-rule)]">
          {snapshots.length === 0 ? (
            <p className="px-4 py-3 text-[11.5px] text-fg-faint">
              {fr.settingsMoreUi.snapshotsEmpty}
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
                  {busy === s.name ? <Spinner size={14} /> : fr.settings.data.restore}
                </Button>
              </div>
            ))
          )}
        </div>
        <SettingsRow
          label={fr.settings.data.import}
          description={fr.settingsMoreUi.importDesc}
          control={
            <Button
              variant="secondary"
              onClick={() => openOverlay({ type: 'settings', section: 'libraries' })}
            >
              {fr.settingsMoreUi.importAction}
            </Button>
          }
        />
        <SettingsRow
          label={fr.settings.data.openFolder}
          description={fr.settingsMoreUi.openFolderDesc}
          control={
            <Button variant="secondary" onClick={() => void reveal()}>
              {fr.settingsMoreUi.openFolderAction}
            </Button>
          }
        />
        <SettingsRow
          label={fr.settingsMoreUi.verifyAction}
          control={
            <Button variant="secondary" onClick={() => void verify()}>
              {fr.settings.ai.check}
            </Button>
          }
        />
      </div>
    </>
  )
}
