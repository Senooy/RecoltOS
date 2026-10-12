/**
 * Réglages › Stockage (DESIGN §3.10, ERRATA §B) : barre empilée de 8 px (Images, Vidéos, Aperçus,
 * Instantanés, en 4 gris) avec légende, « Télécharger les médias distants », « Vider la corbeille
 * automatiquement », « Régénérer les aperçus », « Vider la corbeille maintenant ».
 * « Conserver les originaux » n'est pas proposé : RecoltOS garde toujours les originaux.
 */
import { useCallback, useEffect, useState } from 'react'
import type { z } from 'zod'
import type { StorageBreakdown } from '../../../../../shared/ipc/data'
import { Button, Switch, toast } from '../../../components/ui'
import { fr } from '../../../i18n/fr'
import { bytes } from '../../../lib/format'
import { RpcError, rpc, subscribe } from '../../../lib/rpc'
import { askConfirm } from '../../../state/dialogs'
import { usePrefs } from '../../../state/prefs'
import { SettingsRow, SettingsTitle } from '../SettingsDialog'

type Storage = z.output<typeof StorageBreakdown>

// Gris de la barre d'occupation : tokens par thème (`tokens.css`, --set-storage-1…4).
const GREYS = [
  'var(--set-storage-1)',
  'var(--set-storage-2)',
  'var(--set-storage-3)',
  'var(--set-storage-4)',
]

function fail(err: unknown) {
  toast(err instanceof RpcError ? err.message : fr.errors.generic)
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
        { label: fr.settings.storage.images, value: sizes.images },
        { label: fr.settings.storage.videos, value: sizes.videos },
        {
          label: fr.settings.storage.derived,
          value: sizes.thumbs + sizes.large + sizes.posters + sizes.previews + sizes.display,
        },
        { label: fr.settings.storage.snapshots, value: sizes.snapshots },
      ]
    : []
  const sum = Math.max(1, sizes?.total ?? 1)

  const regenerate = async () => {
    try {
      const r = await rpc('data.regenerateDerived')
      toast(fr.settingsMoreUi.regenStarted(r.count))
    } catch (err) {
      fail(err)
    }
  }
  const emptyTrash = async () => {
    const ok = await askConfirm({
      title: fr.confirm.emptyTrashTitle,
      body: fr.confirm.emptyTrashBody(trash),
      confirmLabel: fr.tabs.emptyTrash,
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
      <SettingsTitle description={fr.settingsMoreUi.storageDesc}>
        {fr.settings.nav.storage}
      </SettingsTitle>
      <div className="mt-5" data-testid="storage-bar">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]">
          {parts.map((p, i) => (
            <div
              key={p.label}
              style={{ width: `${(p.value / sum) * 100}%`, background: GREYS[i] }}
              title={`${p.label} : ${bytes(p.value)}`}
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
              {fr.settingsMoreUi.storageTotal(bytes(sizes.total))}
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-3">
        <SettingsRow
          label={fr.settings.storage.downloadRemote}
          description={fr.settingsMoreUi.downloadRemoteDesc}
          control={
            <Switch
              aria-label={fr.settings.storage.downloadRemote}
              data-testid="pref-download-remote"
              checked={prefs.storage.downloadRemoteMedia}
              onCheckedChange={(downloadRemoteMedia) =>
                update({ storage: { downloadRemoteMedia } })
              }
            />
          }
        />
        <SettingsRow
          label={fr.settings.storage.autoEmpty}
          description={fr.settingsMoreUi.autoEmptyDesc}
          control={
            <select
              aria-label={fr.settings.storage.autoEmpty}
              className="h-[34px] rounded-[10px] border border-[var(--set-field-border)] bg-[var(--set-field-bg)] px-3 text-[12.5px]"
              value={prefs.trashAutoEmptyDays}
              onChange={(e) =>
                update({ trashAutoEmptyDays: Number(e.target.value) as 0 | 7 | 30 | 90 })
              }
            >
              <option value={0}>{fr.settings.storage.never}</option>
              {[7, 30, 90].map((d) => (
                <option key={d} value={d}>
                  {fr.settings.storage.days(d)}
                </option>
              ))}
            </select>
          }
        />
        <SettingsRow
          label={fr.settings.storage.regenDerived}
          description={fr.settingsMoreUi.regenDesc}
          control={
            <Button variant="secondary" onClick={() => void regenerate()}>
              {fr.settingsMoreUi.regenAction}
            </Button>
          }
        />
        <SettingsRow
          label={fr.settings.storage.emptyNow}
          description={fr.settingsMoreUi.emptyNowDesc(trash)}
          control={
            <Button variant="danger" disabled={trash === 0} onClick={() => void emptyTrash()}>
              {fr.settingsMoreUi.emptyAction}
            </Button>
          }
        />
      </div>
    </>
  )
}
