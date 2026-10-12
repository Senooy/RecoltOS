/**
 * AI dialogs mounted once in the shell: "Change" sheet, "Enrich the
 * library" and "What will be sent" (exact preview).
 */
import { useEffect, useState } from 'react'
import type { AiEstimate } from '../../../../shared/dto/ai'
import type { Out } from '../../../../shared/ipc'
import { Button, Dialog, Spinner, toast } from '../../components/ui'
import { tr } from '../../i18n'
import { bytes } from '../../lib/format'
import { RpcError, rpc } from '../../lib/rpc'
import { usePrefs } from '../../state/prefs'
import { aiFail, aiReady, followAiEvents, useAi } from './ai-store'
import { ProviderSheet } from './ProviderSheet'
import './ai.css'

type Preview = Out<'ai.previewPayload'>

function PreviewDialog() {
  const req = useAi((s) => s.preview)
  const close = useAi((s) => s.closePreview)
  const [data, setData] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setData(null)
    setError(null)
    if (!req) return
    void rpc('ai.previewPayload', {
      ...(req.itemUuid ? { itemUuid: req.itemUuid } : {}),
      task: req.task,
    })
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof RpcError ? err.message : tr.aiUi.previewEmpty),
      )
  }, [req])
  const name = data ? (tr.aiUi.shortNames[data.provider] ?? data.provider) : ''
  return (
    <Dialog.Root open={req !== null} onOpenChange={(o) => !o && close()}>
      <Dialog.Content
        title={tr.aiUi.previewTitle}
        description={data ? tr.aiUi.previewDesc(name) : undefined}
        className="w-[min(560px,calc(100vw-48px))]"
        data-testid="ai-preview-dialog"
      >
        <div className="max-h-[70vh] overflow-y-auto px-5 pb-5 pt-3 text-[12.5px]">
          {error ? <p className="text-fg-muted">{error}</p> : null}
          {!data && !error ? <Spinner /> : null}
          {data ? (
            <>
              {data.files.length === 0 ? (
                <p className="text-fg-muted">{tr.aiUi.previewNoFile}</p>
              ) : (
                <div className="flex flex-wrap gap-3" data-testid="ai-preview-files">
                  {data.files.map((f) => (
                    <figure key={f.name} className="w-[150px]">
                      <img
                        src={f.dataUrl}
                        alt={f.name}
                        className="h-[110px] w-[150px] rounded-md bg-surface object-contain"
                      />
                      <figcaption className="mt-1 text-[11.5px] text-fg-muted">
                        {f.name} · {f.width}×{f.height} · {bytes(f.bytes)}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
              <details className="mt-3" open>
                <summary className="cursor-default text-[13px] font-medium">
                  {tr.aiUi.previewPrompt} · {tr.aiUi.previewChars(data.textChars)}
                </summary>
                <pre
                  className="ai-mono mt-1.5 rounded-md bg-surface p-2.5"
                  data-testid="ai-preview-prompt"
                >
                  {data.prompt}
                </pre>
              </details>
              <details className="mt-2">
                <summary className="cursor-default text-[13px] font-medium">
                  {tr.aiUi.previewSystem}
                </summary>
                <pre className="ai-mono mt-1.5 rounded-md bg-surface p-2.5">{data.system}</pre>
              </details>
            </>
          ) : null}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  )
}

function EnrichDialog() {
  const scope = useAi((s) => s.enrich)
  const close = useAi((s) => s.closeEnrich)
  const consent = useAi((s) => s.consentVersion)
  const ai = usePrefs((s) => s.prefs.ai)
  const [plan, setPlan] = useState<{ planId: string; estimate: AiEstimate } | null>(null)
  const [regen, setRegen] = useState(0)
  const [withRegen, setWithRegen] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setPlan(null)
    setWithRegen(false)
    if (!scope) return
    void rpc('ai.batch.create', { scope })
      .then((p) => setPlan({ planId: p.planId, estimate: p.estimate }))
      .catch(aiFail)
    void rpc('ai.estimate', { filter: { regenerateFr: true } })
      .then((e) => setRegen(e.count))
      .catch(() => setRegen(0))
  }, [scope])
  const ready = aiReady(ai.provider, consent)
  const start = () =>
    void (async () => {
      if (!plan) return
      if (!ready) {
        useAi.getState().openSheet()
        return
      }
      setBusy(true)
      let n = 0
      await rpc('ai.batch.start', { planId: plan.planId })
      n += plan.estimate.count
      if (withRegen) {
        const p2 = await rpc('ai.batch.create', { scope: 'regenerate-fr' })
        await rpc('ai.batch.start', { planId: p2.planId })
        n += p2.estimate.count
      }
      toast(tr.aiUi.enrichStarted(n))
      close()
    })()
      .catch(aiFail)
      .finally(() => setBusy(false))
  const calls = (plan?.estimate.calls ?? 0) + (withRegen ? regen : 0)
  const perCall = Math.max(18, 3600 / ai.perHour)
  return (
    <Dialog.Root open={scope !== null} onOpenChange={(o) => !o && close()}>
      <Dialog.Content
        title={tr.ai.enrichTitle}
        className="w-[min(480px,calc(100vw-48px))]"
        data-testid="ai-enrich"
      >
        <div className="px-5 pb-5 pt-2 text-[13px] leading-[19px]">
          {!plan ? (
            <Spinner />
          ) : (
            <>
              <p>{tr.aiUi.enrichDesc(plan.estimate.count)}</p>
              <p className="mt-1.5 text-fg-muted" data-testid="ai-enrich-eta">
                {tr.aiUi.enrichEta(calls, tr.aiUi.eta(calls * perCall), ai.perHour)}
              </p>
              {regen > 0 ? (
                <label className="mt-3 flex items-start gap-2 text-[12.5px]">
                  <input
                    type="checkbox"
                    className="mt-[3px]"
                    checked={withRegen}
                    onChange={(e) => setWithRegen(e.target.checked)}
                  />
                  {tr.aiUi.enrichRegen(regen)}
                </label>
              ) : null}
              <p className="mt-2 text-[12px] text-fg-subtle">{tr.aiUi.enrichXCarousels}</p>
              <button
                type="button"
                className="mt-2 text-[12.5px] underline underline-offset-2"
                onClick={() => useAi.getState().openPreview(null)}
              >
                {tr.ai.previewPayload}
              </button>
              <div className="mt-4 flex justify-end gap-2">
                <Button onClick={close}>{tr.aiUi.enrichLater}</Button>
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={plan.estimate.count + (withRegen ? regen : 0) === 0}
                  data-testid="ai-enrich-start"
                  onClick={start}
                >
                  {ready ? tr.aiUi.enrichStart : tr.aiUi.change}
                </Button>
              </div>
            </>
          )}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  )
}

export function AiDialogs() {
  useEffect(() => followAiEvents(), [])
  return (
    <>
      <ProviderSheet />
      <EnrichDialog />
      <PreviewDialog />
    </>
  )
}
