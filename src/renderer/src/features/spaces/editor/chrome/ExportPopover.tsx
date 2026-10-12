/**
 * PNG export: Scope dialog (All / Selection), Scale (1× 2×
 * 3×), Background (Light / Dark / Theme) → flush → `spaces.exportPng` (stage window on the main side,
 * save location chosen by the user) → progress pill with "Cancel" → toast
 * "Export done · Show in Finder".
 */
import { useEffect, useState } from 'react'
import { Button, Dialog, SegmentedSmall, toast } from '../../../../components/ui'
import { tr } from '../../../../i18n'
import { RpcError, rpc, subscribe } from '../../../../lib/rpc'
import { persistence, useSpace } from '../store/spaceStore'

type Scope = 'all' | 'selection'
type Bg = 'light' | 'dark' | 'theme'

function ExportProgress({ onCancel }: { onCancel: () => void }) {
  const [p, setP] = useState<{ done: number; total: number }>({ done: 0, total: 1 })
  useEffect(() => subscribe('spaces.exportProgress', setP), [])
  return (
    <div
      data-testid="export-progress"
      className="sp-float fixed bottom-6 left-1/2 z-[60] flex h-10 -translate-x-1/2 items-center gap-3 pl-4 pr-1.5 text-small text-fg"
    >
      {tr.spacesExtra.exporting(p.done, p.total)}
      <Button variant="secondary" size="sm" onClick={onCancel}>
        {tr.spacesExtra.cancel}
      </Button>
    </div>
  )
}

export function ExportPopover({
  open,
  onOpenChange,
  spaceUuid,
  name,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  spaceUuid: string
  name: string
}) {
  const hasSelection = useSpace((s) => s.selection.length > 0)
  const [scope, setScope] = useState<Scope>('all')
  const [scale, setScale] = useState<'1' | '2' | '3'>('2')
  const [bg, setBg] = useState<Bg>('theme')
  const [running, setRunning] = useState(false)

  const run = async () => {
    onOpenChange(false)
    if (Object.keys(useSpace.getState().nodes).length === 0) {
      toast(tr.spacesExtra.exportEmpty)
      return
    }
    setRunning(true)
    try {
      await persistence.flush()
      const sel = useSpace.getState().selection
      const r = await rpc('spaces.exportPng', {
        uuid: spaceUuid,
        scope: scope === 'selection' && sel.length > 0 ? 'selection' : 'all',
        ...(scope === 'selection' && sel.length > 0 ? { nodeUuids: sel } : {}),
        scale: Number(scale) as 1 | 2 | 3,
        background: bg,
        name: name || tr.spaces.untitled,
      })
      if ('path' in r) {
        toast(tr.spacesExtra.exportDone, {
          action: {
            label: tr.spacesExtra.revealInFinder,
            onClick: () => void rpc('spaces.revealExport').catch(() => undefined),
          },
        })
      } else toast(tr.spacesExtra.exportCancelled)
    } catch (err) {
      toast(err instanceof RpcError ? err.message : tr.errors.generic)
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Content
          title={tr.spacesExtra.exportTitle}
          className="w-[min(380px,calc(100vw-48px))]"
          data-testid="export-dialog"
        >
          <div className="flex flex-col gap-4 px-5 pb-5 pt-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-small text-fg-muted">{tr.spacesExtra.scope}</span>
              <SegmentedSmall
                label={tr.spacesExtra.scope}
                value={hasSelection ? scope : 'all'}
                onChange={setScope}
                options={[
                  { value: 'all', label: tr.spacesExtra.scopeAll },
                  ...(hasSelection
                    ? [{ value: 'selection' as const, label: tr.spacesExtra.scopeSelection }]
                    : []),
                ]}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-small text-fg-muted">{tr.spacesExtra.scale}</span>
              <SegmentedSmall
                label={tr.spacesExtra.scale}
                value={scale}
                onChange={setScale}
                options={[
                  { value: '1', label: '1×' },
                  { value: '2', label: '2×' },
                  { value: '3', label: '3×' },
                ]}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-small text-fg-muted">{tr.spacesExtra.background}</span>
              <SegmentedSmall
                label={tr.spacesExtra.background}
                value={bg}
                onChange={setBg}
                options={[
                  { value: 'light', label: tr.spacesExtra.bgLight },
                  { value: 'dark', label: tr.spacesExtra.bgDark },
                  { value: 'theme', label: tr.spacesExtra.bgTheme },
                ]}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                {tr.spacesExtra.cancel}
              </Button>
              <Button data-testid="export-run" onClick={() => void run()}>
                {tr.spacesExtra.export}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Root>
      {running ? (
        <ExportProgress onCancel={() => void rpc('spaces.exportCancel').catch(() => undefined)} />
      ) : null}
    </>
  )
}
