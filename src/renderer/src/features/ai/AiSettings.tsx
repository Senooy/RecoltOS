/**
 * Réglages › IA : en haut, titre, intro,
 * encart gris « Moteur : … » + pilule noire « Changer », filet, DEUX lignes à interrupteur
 * (« Nommer automatiquement… », « Décrire et taguer… » : pas de « Recherche visuelle »). Dessous, repliés : « Avancé » (modèle, effort, secours, titres, débit,
 * file, lots) et « Confidentialité » (ce qui est envoyé, aperçu, journal).
 */
import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AiCliId } from '../../../../shared/ai-types'
import type { AiCallEntry } from '../../../../shared/dto/ai'
import type { Prefs } from '../../../../shared/prefs'
import { Button, Switch, toast } from '../../components/ui'
import { tr } from '../../i18n'
import { bytes, dateShort, hourMinute } from '../../lib/format'
import { rpc } from '../../lib/rpc'
import { usePrefs } from '../../state/prefs'
import { SettingsTitle } from '../settings/SettingsDialog'
import { aiFail, aiReady, useAi } from './ai-store'
import './ai.css'

const MODELS = ['auto', 'sonnet', 'haiku', 'opus', 'fable'] as const
const PRESETS = { soft: 30, normal: 120, fast: 300 } as const

const hhmm = (ts: number): string => hourMinute(ts)

export function useEngineLine(): {
  title: string
  help: string
  tone: 'ok' | 'warn' | 'err' | 'off'
} {
  const ai = usePrefs((s) => s.prefs.ai)
  const consent = useAi((s) => s.consentVersion)
  const detect = useAi((s) => s.detect)
  const queue = useAi((s) => s.queue)
  const t = tr.aiUi
  if (ai.provider === 'off')
    return { title: t.engineTitle(t.engineNone), help: t.state.off, tone: 'off' }
  const title = t.engineTitle(t.providerNames[ai.provider] ?? ai.provider)
  if (consent === null) return { title, help: t.state.noConsent, tone: 'warn' }
  const st = detect?.[ai.provider]
  const paused = queue?.cli.providers[ai.provider].paused
  if (paused) {
    const reason = t.pauseReasons[paused.reason] ?? paused.reason
    return {
      title,
      help: t.state.paused(reason, paused.until ? hhmm(paused.until) : undefined),
      tone: 'warn',
    }
  }
  if (!st) return { title, help: t.state.checking, tone: 'off' }
  if (!st.installed) return { title, help: t.state.notFound, tone: 'err' }
  if (st.loggedIn === false) return { title, help: t.state.notLogged, tone: 'err' }
  if (st.authKind === 'api_key') return { title, help: t.state.apiKey, tone: 'warn' }
  return { title, help: t.state.connected(st.plan), tone: 'ok' }
}

function Fold({
  label,
  testId,
  children,
}: {
  label: string
  testId: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        className="ai-fold"
        data-testid={testId}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        <ChevronRight size={15} strokeWidth={1.75} />
      </button>
      {open ? <div className="pb-3 pt-1">{children}</div> : null}
    </div>
  )
}

function Sub({ label, children }: { label: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="ai-sub">
      <div className="ai-sub-label">{label}</div>
      {children}
    </div>
  )
}

function ModelField({
  ai,
  update,
}: {
  ai: Prefs['ai']
  update: (p: Partial<Prefs['ai']>) => void
}) {
  const known = (MODELS as readonly string[]).includes(ai.claude.model)
  const [custom, setCustom] = useState(known ? '' : ai.claude.model)
  return (
    <div className="flex items-center gap-2">
      <select
        className="ai-select"
        aria-label={tr.aiUi.model}
        data-testid="ai-model"
        value={known ? ai.claude.model : '__custom'}
        onChange={(e) => {
          const v = e.target.value
          if (v === '__custom') setCustom(ai.claude.model)
          else update({ claude: { ...ai.claude, model: v } })
        }}
      >
        {MODELS.map((m) => (
          <option key={m} value={m}>
            {m === 'auto' ? tr.aiUi.modelAuto : m}
          </option>
        ))}
        <option value="__custom">{tr.aiUi.modelCustom}</option>
      </select>
      {!known || custom ? (
        <input
          className="ai-select w-[170px]"
          aria-label={tr.aiUi.modelPlaceholder}
          placeholder={tr.aiUi.modelPlaceholder}
          value={custom}
          spellCheck={false}
          onChange={(e) => setCustom(e.target.value)}
          onBlur={() => {
            const v = custom.trim()
            if (/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(v))
              update({ claude: { ...ai.claude, model: v } })
          }}
        />
      ) : null}
    </div>
  )
}

function QueueBlock() {
  const queue = useAi((s) => s.queue)
  const provider = usePrefs((s) => s.prefs.ai.provider)
  const [missing, setMissing] = useState<number | null>(null)
  const [regen, setRegen] = useState<number | null>(null)
  useEffect(() => {
    void rpc('ai.estimate', { filter: { missingDescription: true } })
      .then((e) => setMissing(e.count))
      .catch(() => setMissing(null))
    void rpc('ai.estimate', { filter: { regenerateFr: true } })
      .then((e) => setRegen(e.count))
      .catch(() => setRegen(null))
  }, [queue?.cli.done])
  const control = (action: 'pause' | 'resume' | 'cancel' | 'retryFailed') =>
    void rpc('ai.queue.control', { action }).catch(aiFail)
  const startScope = (scope: 'unanalyzed' | 'regenerate-fr') =>
    void rpc('ai.batch.create', { scope })
      .then((p) => rpc('ai.batch.start', { planId: p.planId }).then(() => p.estimate.count))
      .then((n) => toast(tr.aiUi.enrichStarted(n)))
      .catch(aiFail)
  const paused = queue && provider !== 'off' ? queue.cli.providers[provider].paused : undefined
  return (
    <div data-testid="ai-queue">
      <Sub label={tr.aiUi.queue}>
        <span className="text-[11px] text-fg-muted">
          {queue ? tr.aiUi.queueStats(queue.cli.queued, queue.cli.running, queue.cli.failed) : '…'}
        </span>
      </Sub>
      {queue ? (
        <p className="-mt-1 mb-2 text-[11px] text-fg-subtle">
          {tr.aiUi.budgetUsed(
            queue.budget.hourUsed,
            queue.budget.hourLimit,
            queue.budget.dayUsed,
            queue.budget.dayLimit,
          )}
          {queue.batch
            ? ` · ${queue.batch.label} ${queue.batch.done}/${queue.batch.total} (${tr.aiUi.eta(queue.batch.etaSec)})`
            : ''}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {paused?.reason === 'USER' ? (
          <Button size="sm" onClick={() => control('resume')}>
            {tr.aiUi.resume}
          </Button>
        ) : (
          <Button size="sm" onClick={() => control('pause')}>
            {tr.aiUi.pause}
          </Button>
        )}
        <Button size="sm" onClick={() => control('cancel')}>
          {tr.aiUi.cancelAll}
        </Button>
        <Button size="sm" onClick={() => control('retryFailed')} disabled={!queue?.cli.failed}>
          {tr.aiUi.retryFailed}
        </Button>
        {paused?.reason === 'HARD_CAP' ? (
          <Button
            size="sm"
            onClick={() =>
              void rpc('ai.budget.override', { until: Date.now() + 86_400_000 }).catch(aiFail)
            }
          >
            {tr.aiUi.overrideCap}
          </Button>
        ) : null}
      </div>
      <div className="mt-3 flex flex-col items-start gap-2">
        <Button
          size="sm"
          data-testid="ai-analyze-rest"
          disabled={!missing}
          onClick={() => startScope('unanalyzed')}
        >
          {tr.aiUi.analyzeRest(missing ?? 0)}
        </Button>
        <Button size="sm" disabled={!regen} onClick={() => startScope('regenerate-fr')}>
          {tr.aiUi.regenerateFr(regen ?? 0)}
        </Button>
      </div>
    </div>
  )
}

function CallsLog() {
  const [calls, setCalls] = useState<AiCallEntry[] | null>(null)
  const load = () =>
    void rpc('ai.calls.list', { limit: 100 })
      .then(setCalls)
      .catch(() => setCalls([]))
  useEffect(load, [])
  return (
    <div data-testid="ai-calls">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-[12px] font-medium">{tr.aiUi.log}</div>
        <Button
          size="sm"
          variant="ghost"
          disabled={!calls?.length}
          onClick={() =>
            void rpc('ai.calls.clear')
              .then((r) => {
                toast(tr.aiUi.logCleared(r.count))
                load()
              })
              .catch(aiFail)
          }
        >
          {tr.aiUi.logClear}
        </Button>
      </div>
      {calls && calls.length === 0 ? (
        <p className="text-[11px] text-fg-muted">{tr.aiUi.logEmpty}</p>
      ) : (
        <div className="max-h-[220px] overflow-y-auto">
          <table className="ai-table">
            <tbody>
              {(calls ?? []).map((c) => (
                <tr key={c.id} data-testid="ai-call">
                  <td className="whitespace-nowrap">
                    {dateShort(c.ts)} {hhmm(c.ts)}
                  </td>
                  <td>
                    {tr.aiUi.shortNames[c.provider] ?? c.provider}
                    {c.model ? ` · ${c.model}` : ''}
                  </td>
                  <td>
                    {tr.aiUi.logFiles(
                      c.sentFiles.length,
                      bytes(c.sentFiles.reduce((s, f) => s + f.bytes, 0)),
                    )}
                    {` · ${c.sentTextChars} car.`}
                  </td>
                  <td className={c.outcome === 'ok' ? '' : 'text-danger'}>
                    {tr.aiUi.outcomes[c.outcome] ?? c.outcome}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function AiSettings() {
  const ai = usePrefs((s) => s.prefs.ai)
  const consent = useAi((s) => s.consentVersion)
  const openSheet = useAi((s) => s.openSheet)
  const openPreview = useAi((s) => s.openPreview)
  const line = useEngineLine()
  const ready = aiReady(ai.provider, consent)
  useEffect(() => {
    void useAi.getState().refresh()
    if (ai.provider !== 'off') void useAi.getState().runDetect()
  }, [ai.provider])
  const update = (patch: Partial<Prefs['ai']>) =>
    void usePrefs.getState().update({ ai: patch }).catch(aiFail)
  const toggle = (key: 'autoNameOnSave' | 'autoAnalyzeOnSave', on: boolean) => {
    update({ [key]: on })
    if (on && !ready) openSheet()
  }
  const preset = (Object.entries(PRESETS).find(([, v]) => v === ai.perHour)?.[0] ?? '') as
    keyof typeof PRESETS | ''
  return (
    <div data-testid="ai-settings">
      <SettingsTitle description={tr.settings.ai.desc}>{tr.settings.nav.ai}</SettingsTitle>
      <div className="ai-card mt-4" data-testid="ai-engine-card" data-tone={line.tone}>
        <div className="min-w-0 flex-1">
          <div className="ai-card-title" data-testid="ai-engine-title">
            {line.title}
          </div>
          <div className="ai-card-help" data-testid="ai-engine-status">
            {line.help}
          </div>
        </div>
        <button type="button" className="ai-pill-black" data-testid="ai-change" onClick={openSheet}>
          {tr.aiUi.change}
        </button>
      </div>
      <div className="ai-rule mt-4" />
      <div>
        <div className="ai-row">
          <div className="min-w-0 flex-1">
            <div className="ai-row-label" id="ai-autoname">
              {tr.aiUi.autoName}
            </div>
            <div className="ai-row-help">{tr.aiUi.autoNameDesc}</div>
          </div>
          <Switch
            aria-labelledby="ai-autoname"
            data-testid="ai-autoname"
            checked={ready && ai.autoNameOnSave}
            onCheckedChange={(v) => toggle('autoNameOnSave', v)}
          />
        </div>
        <div className="ai-row">
          <div className="min-w-0 flex-1">
            <div className="ai-row-label" id="ai-autoanalyze">
              {tr.aiUi.autoAnalyze}
            </div>
            <div className="ai-row-help">{tr.aiUi.autoAnalyzeDesc}</div>
          </div>
          <Switch
            aria-labelledby="ai-autoanalyze"
            data-testid="ai-autoanalyze"
            checked={ready && ai.autoAnalyzeOnSave}
            onCheckedChange={(v) => toggle('autoAnalyzeOnSave', v)}
          />
        </div>
      </div>
      <div className="ai-rule mt-3" />
      <Fold label={tr.aiUi.advanced} testId="ai-advanced">
        <Sub label={tr.aiUi.model}>
          <ModelField ai={ai} update={update} />
        </Sub>
        <Sub label={tr.aiUi.effort}>
          <select
            className="ai-select"
            aria-label={tr.aiUi.effort}
            value={ai.claude.effort}
            onChange={(e) => {
              const effort = e.target.value as 'low' | 'medium'
              update({ claude: { ...ai.claude, effort }, codex: { ...ai.codex, effort } })
            }}
          >
            {(['low', 'medium'] as const).map((v) => (
              <option key={v} value={v}>
                {tr.aiUi.efforts[v]}
              </option>
            ))}
          </select>
        </Sub>
        <Sub
          label={
            <>
              {tr.aiUi.fallback}
              <div className="text-[11px] text-fg-subtle">{tr.aiUi.fallbackHelp}</div>
            </>
          }
        >
          <select
            className="ai-select"
            aria-label={tr.aiUi.fallback}
            value={ai.fallback}
            onChange={(e) => update({ fallback: e.target.value as Prefs['ai']['fallback'] })}
          >
            {(['none', 'claude', 'codex'] as const)
              .filter((v) => v === 'none' || v !== ai.provider)
              .map((v) => (
                <option key={v} value={v}>
                  {v === 'none' ? tr.aiUi.providerNames.off : tr.aiUi.providerNames[v]}
                </option>
              ))}
          </select>
        </Sub>
        <Sub label={tr.aiUi.titlePolicy}>
          <select
            className="ai-select"
            aria-label={tr.aiUi.titlePolicy}
            value={ai.titlePolicy}
            onChange={(e) => update({ titlePolicy: e.target.value as 'empty' | 'always' })}
          >
            {(['empty', 'always'] as const).map((v) => (
              <option key={v} value={v}>
                {tr.aiUi.titlePolicies[v]}
              </option>
            ))}
          </select>
        </Sub>
        <Sub
          label={
            <>
              {tr.aiUi.rate}
              <div className="text-[11px] text-fg-subtle">
                {tr.aiUi.rateHelp(ai.perHour, ai.perDay, ai.hardPerDay)}
              </div>
            </>
          }
        >
          <select
            className="ai-select"
            aria-label={tr.aiUi.rate}
            value={preset}
            onChange={(e) => {
              const k = e.target.value as keyof typeof PRESETS
              if (PRESETS[k]) update({ perHour: PRESETS[k] })
            }}
          >
            {preset === '' ? <option value="">{ai.perHour} / h</option> : null}
            {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((k) => (
              <option key={k} value={k}>
                {tr.aiUi.presets[k]} ({PRESETS[k]} / h)
              </option>
            ))}
          </select>
        </Sub>
        <Sub label={tr.aiUi.concurrency}>
          <select
            className="ai-select"
            aria-label={tr.aiUi.concurrency}
            value={ai.concurrency}
            onChange={(e) => update({ concurrency: Number(e.target.value) === 2 ? 2 : 1 })}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </Sub>
        <div className="ai-rule my-2" />
        <QueueBlock />
      </Fold>
      <Fold label={tr.aiUi.privacy} testId="ai-privacy">
        <div className="mb-1 text-[12px] font-medium">{tr.aiUi.sentTitle}</div>
        <table className="ai-table" data-testid="ai-sent-table">
          <tbody>
            {tr.aiUi.sentRows.map(([k, v]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-fg-subtle">{tr.aiUi.neverSent}</p>
        <div className="mb-4 mt-3">
          <Button size="sm" data-testid="ai-preview" onClick={() => openPreview(null)}>
            {tr.aiUi.preview}
          </Button>
        </div>
        <CallsLog />
      </Fold>
    </div>
  )
}

export type { AiCliId }
