/**
 * Réglages › Bibliothèques : liste en carte (nom, chemin, nombre
 * d'éléments, menu « … »), « Nouvelle bibliothèque », « Ouvrir un dossier… », et l'encart
 * « Importer depuis GatherOS » (détection, options, cible, progression par phase, aperçus, résumé).
 */
import { Check, Ellipsis, FolderOpen, Pencil, Plus, Trash } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { ImportProgress, ImportReport } from '../../../../../shared/ipc/import'
import { Button, Menu, toast } from '../../../components/ui'
import { libraryDisplayName, tr } from '../../../i18n'
import { bytes, labelled } from '../../../lib/format'
import { isNotImplemented, RpcError, rpc, subscribe } from '../../../lib/rpc'
import { askConfirm, askName } from '../../../state/dialogs'
import { usePrefs } from '../../../state/prefs'
import { useUi } from '../../../state/ui'
import { useLibraries } from '../../../shell/LibraryPicker'
import { SettingsTitle } from '../SettingsDialog'
import { useAi } from '../../ai/ai-store'

type Detect = Awaited<ReturnType<typeof rpc<'import.gatheros.detect'>>>

function err(e: unknown): void {
  toast(e instanceof RpcError ? e.message : tr.errors.generic)
}

function LibrariesList() {
  const { active, libraries } = useLibraries()
  const rename = async (id: string, current: string) => {
    const name = await askName({
      title: tr.shell.rename,
      initial: current,
      confirmLabel: tr.shell.rename,
    })
    if (name && name !== current) await rpc('libraries.rename', { id, name }).catch(err)
  }
  const remove = async (id: string, name: string) => {
    const ok = await askConfirm({
      title: tr.settingsUi.removeTitle(name),
      body: tr.settingsUi.removeBody,
      confirmLabel: tr.settingsUi.remove,
      danger: true,
    })
    if (ok) await rpc('libraries.remove', { id, deleteFiles: false }).catch(err)
  }
  return (
    <div className="mt-5 overflow-hidden rounded-[10px] border border-border">
      {libraries.map((l, i) => (
        <div
          key={l.id}
          className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-border-subtle' : ''}`}
          data-testid="library-row"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              {libraryDisplayName(l)}
              {l.id === active ? (
                <Check size={14} className="text-fg-subtle" aria-label={tr.settingsUi.active} />
              ) : null}
            </div>
            <div className="truncate font-mono text-[11px] text-fg-subtle">{l.path ?? l.id}</div>
            <div className="text-[11px] text-[var(--set-help)]">{tr.count.items(l.itemCount)}</div>
          </div>
          {l.id !== active ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void rpc('libraries.switch', { id: l.id }).catch(err)}
            >
              {tr.settingsUi.switchTo}
            </Button>
          ) : null}
          <Menu.Dropdown.Root>
            <Menu.Dropdown.Trigger asChild>
              <button
                type="button"
                aria-label={tr.settingsUi.libraryMenu}
                className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--hover)]"
              >
                <Ellipsis size={16} />
              </button>
            </Menu.Dropdown.Trigger>
            <Menu.Dropdown.Content align="end">
              <Menu.Dropdown.Item icon={<Pencil />} onSelect={() => void rename(l.id, l.name)}>
                {tr.shell.rename}
              </Menu.Dropdown.Item>
              <Menu.Dropdown.Item
                icon={<FolderOpen />}
                onSelect={() => void rpc('libraries.reveal', { id: l.id }).catch(err)}
              >
                {tr.settingsUi.reveal}
              </Menu.Dropdown.Item>
              {l.id !== active ? (
                <Menu.Dropdown.Item
                  tone="danger"
                  icon={<Trash />}
                  onSelect={() => void remove(l.id, l.name)}
                >
                  {tr.settingsUi.remove}
                </Menu.Dropdown.Item>
              ) : null}
            </Menu.Dropdown.Content>
          </Menu.Dropdown.Root>
        </div>
      ))}
    </div>
  )
}

function Check2({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  children: string
}) {
  return (
    <label className="flex cursor-default items-center gap-2 py-1 text-[12px]">
      <input
        type="checkbox"
        className="h-3.5 w-3.5 accent-[var(--accent)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  )
}

function useDerivedProgress(active: boolean) {
  const [state, setState] = useState<{ remaining: number; peak: number }>({ remaining: 0, peak: 0 })
  useEffect(() => {
    if (!active) return
    const read = (s: { byType: Record<string, { queued: number; running: number }> }) => {
      const t = ['media.derive', 'media.download']
      const remaining = t.reduce(
        (n, k) => n + (s.byType[k]?.queued ?? 0) + (s.byType[k]?.running ?? 0),
        0,
      )
      setState((p) => ({ remaining, peak: Math.max(p.peak, remaining) }))
    }
    void rpc('jobs.status')
      .then(read)
      .catch(() => undefined)
    const off = subscribe('jobs.progress', read)
    return off
  }, [active])
  return state
}

export function ImportPanel() {
  const [detect, setDetect] = useState<Detect | null>(null)
  const [detecting, setDetecting] = useState(true)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [running, setRunning] = useState(false)
  const [details, setDetails] = useState<'missing' | 'duplicates' | null>(null)
  const [opts, setOpts] = useState({
    includeTrash: true,
    includeHidden: true,
    importAiFields: true,
    importPrefs: false,
    skipStarterContent: true,
    ignoreTombstones: false,
  })
  const [target, setTarget] = useState<'active' | 'new'>('active')
  const provider = usePrefs((s) => s.prefs.ai.provider)
  const openOverlay = useUi((s) => s.openOverlay)
  const derived = useDerivedProgress(report !== null || running)

  const runDetect = useCallback(() => {
    setDetecting(true)
    void rpc('import.gatheros.detect')
      .then(setDetect)
      .catch((e: unknown) => {
        if (!isNotImplemented(e)) err(e)
      })
      .finally(() => setDetecting(false))
  }, [])
  useEffect(() => {
    runDetect()
    const off = subscribe('import.progress', (p) => {
      setProgress(p)
      if (p.phase === 'done') {
        setRunning(false)
        void rpc('import.gatheros.lastReport').then((r) => {
          if (r && r.runId === p.runId) setReport(r)
          if (r?.state === 'cancelled') toast(tr.importUi.cancelled)
          else if (r?.state === 'failed') toast(r.error ?? tr.importUi.failed)
        })
      }
    })
    return off
  }, [runDetect])

  const start = async () => {
    setReport(null)
    setDetails(null)
    try {
      setRunning(true)
      await rpc('import.gatheros.start', { options: { ...opts, importSpaces: true }, target })
    } catch (e) {
      setRunning(false)
      err(e)
      runDetect()
    }
  }

  const c = detect?.counts
  const phaseLabel = progress ? (tr.importUi.phases[progress.phase] ?? progress.phase) : ''
  const pct =
    progress && progress.total > 0
      ? Math.min(100, (progress.done / progress.total) * 100)
      : running
        ? 5
        : 0
  const derivedTotal = derived.peak
  const derivedDone = derivedTotal - derived.remaining

  return (
    <section
      data-testid="import-panel"
      className="mt-6 rounded-[10px] border border-[var(--set-box-border)] bg-surface-info px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">{tr.settings.libraries.importTitle}</div>
          <p className="mt-0.5 text-[11px] text-fg-muted">{tr.settings.libraries.importBody}</p>
        </div>
      </div>

      {detecting && !detect ? (
        <p className="mt-3 text-[11.5px] text-fg-muted">{tr.importUi.detecting}</p>
      ) : null}
      {detect && !detect.found ? (
        <p className="mt-3 text-[11.5px] text-fg-muted">{tr.importUi.notFound}</p>
      ) : null}

      {detect?.found && c ? (
        <div
          className="mt-3 rounded-lg border border-border bg-bg px-3 py-2.5 text-[11.5px]"
          data-testid="import-detect"
        >
          <div className="font-medium">{tr.importUi.found(detect.libraryName ?? 'Library')}</div>
          <div className="text-fg-muted">
            {tr.importUi.summary(c.items, c.images, c.videos, c.posts, c.links)} —{' '}
            {tr.importUi.collectionsAndSize(c.collections, bytes(c.bytes))}
          </div>
        </div>
      ) : null}

      {detect?.found && !running && !report ? (
        <>
          <div className="mt-3 grid grid-cols-1 gap-0.5">
            <Check2
              checked={opts.includeTrash}
              onChange={(v) => setOpts({ ...opts, includeTrash: v })}
            >
              {tr.importUi.includeTrash(c?.trash ?? 0)}
            </Check2>
            <Check2
              checked={opts.includeHidden}
              onChange={(v) => setOpts({ ...opts, includeHidden: v })}
            >
              {tr.importUi.includeHidden(c?.hidden ?? 0)}
            </Check2>
            <Check2
              checked={opts.importAiFields}
              onChange={(v) => setOpts({ ...opts, importAiFields: v })}
            >
              {tr.importUi.aiFields}
            </Check2>
            <Check2
              checked={opts.importPrefs}
              onChange={(v) => setOpts({ ...opts, importPrefs: v })}
            >
              {tr.importUi.prefs}
            </Check2>
            <Check2
              checked={opts.skipStarterContent}
              onChange={(v) => setOpts({ ...opts, skipStarterContent: v })}
            >
              {tr.importUi.skipStarter(c?.starter ?? 0)}
            </Check2>
            <Check2
              checked={opts.ignoreTombstones}
              onChange={(v) => setOpts({ ...opts, ignoreTombstones: v })}
            >
              {labelled(tr.importUi.advanced, tr.importUi.ignoreTombstones)}
            </Check2>
          </div>
          <div className="mt-2 flex items-center gap-3 text-[12px]">
            <span className="text-fg-muted">{tr.importUi.target}</span>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="import-target"
                checked={target === 'active'}
                onChange={() => setTarget('active')}
              />
              {tr.importUi.targetActive}
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="import-target"
                checked={target === 'new'}
                onChange={() => setTarget('new')}
              />
              {tr.importUi.targetNew}
            </label>
          </div>
          {detect.running ? (
            <div
              className="mt-3 flex items-center gap-3 text-[11.5px]"
              data-testid="import-running"
            >
              <span className="text-danger">{tr.importUi.running}</span>
              <Button size="sm" variant="secondary" onClick={runDetect}>
                {tr.importUi.retry}
              </Button>
            </div>
          ) : null}
          <div className="mt-3">
            <Button
              variant="primary"
              data-testid="import-start"
              disabled={detect.running}
              onClick={() => void start()}
            >
              {tr.settings.libraries.importCta}
            </Button>
          </div>
        </>
      ) : null}

      {running ? (
        <div className="mt-3" data-testid="import-progress">
          <div className="h-1 overflow-hidden rounded-full bg-[var(--slider-track)]">
            <div
              className="h-full bg-accent transition-[width] duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-fg-muted">
            <span className="tnum">
              {progress && progress.total > 0
                ? tr.settings.libraries.importing(progress.done, progress.total, phaseLabel)
                : phaseLabel}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void rpc('import.gatheros.cancel').catch(err)}
            >
              {tr.importUi.cancel}
            </Button>
          </div>
        </div>
      ) : null}

      {report && report.state === 'done' ? (
        <div className="mt-3 text-[11.5px]" data-testid="import-summary">
          <div className="font-medium">{tr.importUi.doneTitle}</div>
          <div className="text-fg-muted">
            {tr.importUi.counts(
              report.counts.items ?? 0,
              report.counts.collections ?? 0,
              report.counts.skipped_existing ?? 0,
            )}
          </div>
          {derivedTotal > 0 ? (
            <div className="mt-1 text-fg-muted tnum" data-testid="import-derived">
              {tr.importUi.derived(derivedDone, derivedTotal)}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {report.missingFiles.length > 0 ? (
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() => setDetails('missing')}
              >
                {tr.importUi.missingFiles(report.missingFiles.length)}
              </button>
            ) : null}
            {report.urlDuplicates.length > 0 ? (
              <button
                type="button"
                data-testid="import-duplicates"
                className="underline-offset-2 hover:underline"
                onClick={() => setDetails('duplicates')}
              >
                {tr.importUi.urlDuplicates(report.urlDuplicates.length)}
              </button>
            ) : null}
            <button
              type="button"
              className="underline-offset-2 hover:underline"
              onClick={() => void rpc('import.gatheros.revealReport').catch(err)}
            >
              {tr.importUi.openReport}
            </button>
          </div>
          {details === 'duplicates' ? (
            <ul className="select-text mt-2 max-h-32 overflow-y-auto rounded-md border border-border bg-bg p-2 font-mono text-[10.5px]">
              {report.urlDuplicates.map((d) => (
                <li key={d.url} className="truncate">
                  {d.url} ({d.itemUuids.length})
                </li>
              ))}
            </ul>
          ) : null}
          {details === 'missing' ? (
            <ul className="select-text mt-2 max-h-32 overflow-y-auto rounded-md border border-border bg-bg p-2 font-mono text-[10.5px]">
              {report.missingFiles.map((m) => (
                <li key={m.itemUuid + m.file} className="truncate">
                  {m.file}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              data-testid="import-enrich"
              disabled={report.missingDescription === 0}
              onClick={() => useAi.getState().openEnrich('import')}
            >
              {tr.importUi.enrich(report.missingDescription)}
            </Button>
            {provider === 'off' ? (
              <button
                type="button"
                className="text-[11.5px] text-fg-muted underline-offset-2 hover:underline"
                onClick={() => openOverlay({ type: 'settings', section: 'ai' })}
              >
                {tr.importUi.enrichOff}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function LibrariesSection() {
  const create = async () => {
    const name = await askName({
      title: tr.shell.newLibraryTitle,
      initial: tr.shell.newLibraryDefault,
      confirmLabel: tr.shell.create,
    })
    if (name) await rpc('libraries.create', { name }).catch(err)
  }
  return (
    <>
      <SettingsTitle description={tr.settings.libraries.desc}>
        {tr.settings.nav.libraries}
      </SettingsTitle>
      <LibrariesList />
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" icon={<Plus size={15} />} onClick={() => void create()}>
          {tr.settings.libraries.new}
        </Button>
        <Button
          variant="secondary"
          icon={<FolderOpen size={15} />}
          onClick={() => void rpc('libraries.openFolder').catch(err)}
        >
          {tr.settings.libraries.openFolder}
        </Button>
      </div>
      <ImportPanel />
    </>
  )
}
