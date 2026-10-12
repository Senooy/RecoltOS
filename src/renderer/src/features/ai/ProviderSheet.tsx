/**
 * "Change" sheet: engine choice (Claude, ChatGPT / Codex, None), detected state
 * (path, copies, version, connection), "Check" (level 1, free), "Test a real call"
 * (level 2, 1 request) and consent. NO call before "I understand".
 */
import { useEffect, useState } from 'react'
import {
  AI_CONSENT_VERSION,
  type AiCliId,
  type ProviderStatus,
  type ProviderTestResult,
} from '../../../../shared/ai-types'
import { Button, Dialog } from '../../components/ui'
import { tr } from '../../i18n'
import { labelled, listSep } from '../../lib/format'
import { cn } from '../../lib/cn'
import { rpc } from '../../lib/rpc'
import { usePrefs } from '../../state/prefs'
import { aiFail, useAi } from './ai-store'
import './ai.css'

type Choice = AiCliId | 'off'

function tone(st: ProviderStatus | undefined): 'ok' | 'warn' | 'err' | '' {
  if (!st) return ''
  if (!st.installed || st.loggedIn === false) return 'err'
  if (st.authKind === 'api_key' || st.warnings.length > 0) return 'warn'
  return 'ok'
}

function statusText(st: ProviderStatus | undefined, detecting: boolean): string {
  const t = tr.aiUi.state
  if (!st) return detecting ? t.checking : ''
  if (!st.installed) return t.notFound
  if (st.loggedIn === false) return t.notLogged
  return `${t.connected(st.plan)}${st.version ? ` · ${tr.aiUi.version(st.version)}` : ''}`
}

export function ProviderSheet() {
  const open = useAi((s) => s.sheetOpen)
  const close = useAi((s) => s.closeSheet)
  const detect = useAi((s) => s.detect)
  const detecting = useAi((s) => s.detecting)
  const consent = useAi((s) => s.consentVersion)
  const provider = usePrefs((s) => s.prefs.ai.provider)
  const [choice, setChoice] = useState<Choice>(provider)
  const [test, setTest] = useState<{ p: AiCliId; r: ProviderTestResult | null } | null>(null)
  useEffect(() => {
    if (!open) return
    setChoice(provider === 'off' ? 'claude' : provider)
    setTest(null)
    void useAi.getState().refresh()
    void useAi.getState().runDetect()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const needsConsent = choice !== 'off' && consent === null
  const apply = async () => {
    if (choice !== provider) await usePrefs.getState().update({ ai: { provider: choice } })
    await useAi.getState().refresh()
  }
  const confirm = () =>
    void (async () => {
      if (needsConsent) await rpc('ai.consent', { version: AI_CONSENT_VERSION })
      await apply()
      close()
    })().catch(aiFail)

  const st = choice !== 'off' ? detect?.[choice] : undefined
  const name = choice !== 'off' ? (tr.aiUi.shortNames[choice] ?? choice) : ''
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Content
        title={tr.aiUi.sheetTitle}
        description={tr.aiUi.sheetDesc}
        className="w-[min(500px,calc(100vw-48px))]"
        data-testid="ai-sheet"
      >
        <div
          className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto px-5 pb-5 pt-4"
          role="radiogroup"
          aria-label={tr.aiUi.sheetTitle}
        >
          {(['claude', 'codex', 'off'] as const).map((c) => {
            const s = c !== 'off' ? detect?.[c] : undefined
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={choice === c}
                data-testid={`ai-choice-${c}`}
                className="ai-radio"
                onClick={() => setChoice(c)}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-full border',
                    choice === c ? 'border-fg' : 'border-border-strong',
                  )}
                >
                  {choice === c ? <span className="h-2 w-2 rounded-full bg-fg" /> : null}
                </span>
                <span className="flex-1">
                  <span className="block text-[14px] font-medium">
                    {c === 'off'
                      ? tr.aiUi.providerNames.off
                      : `${tr.aiUi.providerNames[c]} (abonnement)`}
                  </span>
                  {c !== 'off' ? (
                    <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-fg-muted">
                      <span className={cn('ai-dot', tone(s))} />
                      {statusText(s, detecting)}
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}

          {choice !== 'off' && st ? (
            <div
              className="mt-1 rounded-[10px] bg-surface px-3 py-2.5 text-[12px]"
              data-testid="ai-sheet-details"
            >
              {st.path ? (
                <div className="flex gap-2">
                  <span className="text-fg-muted">{tr.aiUi.path}</span>
                  <span className="min-w-0 truncate font-mono text-[11.5px]" title={st.path}>
                    {st.path}
                  </span>
                </div>
              ) : null}
              {st.candidates && st.candidates.length > 1 ? (
                <div className="mt-1 text-fg-muted">
                  {labelled(
                    tr.aiUi.copies(st.candidates.length),
                    st.candidates
                      .map((c) => `${c.path}${c.version ? ` (${c.version})` : ''}`)
                      .join(listSep()),
                  )}
                </div>
              ) : null}
              {st.warnings.map((w) => (
                <div key={w} className="mt-1 text-[var(--tone-warn)]">
                  {w}
                </div>
              ))}
              {choice === 'claude' ? (
                <div className="mt-1 text-fg-subtle">{tr.aiUi.keychainHint}</div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  loading={detecting}
                  onClick={() => void useAi.getState().runDetect()}
                >
                  {tr.aiUi.verify}
                </Button>
                <Button
                  size="sm"
                  data-testid="ai-live-test"
                  disabled={needsConsent || choice !== provider || test?.r === null}
                  title={tr.aiUi.liveTestHint}
                  onClick={() => {
                    setTest({ p: choice, r: null })
                    void rpc('ai.test', { provider: choice, live: true })
                      .then((r) => setTest({ p: choice, r }))
                      .catch((err: unknown) => {
                        setTest(null)
                        aiFail(err)
                      })
                  }}
                >
                  {tr.aiUi.liveTest}
                </Button>
              </div>
              {test?.p === choice ? (
                <div className="mt-1.5" data-testid="ai-live-result">
                  {test.r === null
                    ? tr.aiUi.state.checking
                    : test.r.ok
                      ? tr.aiUi.liveOk(test.r.latencyMs ?? 0, test.r.model)
                      : tr.aiUi.liveFail(test.r.error ?? '')}
                </div>
              ) : null}
            </div>
          ) : null}

          {needsConsent ? (
            <div
              className="mt-2 rounded-[10px] border border-border px-3 py-3 text-[12.5px] leading-[18px]"
              data-testid="ai-consent"
            >
              <div className="mb-1.5 text-[13.5px] font-semibold">{tr.aiUi.consentTitle}</div>
              <p>{tr.aiUi.consentIntro(name)}</p>
              <table className="ai-table mt-2">
                <tbody>
                  {tr.aiUi.sentRows.map(([k, v]) => (
                    <tr key={k}>
                      <th scope="row">{k}</th>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-fg-muted">{tr.aiUi.neverSent}</p>
              <p className="mt-1.5 text-fg-muted">{tr.aiUi.consentThirdParty}</p>
              <p className="mt-1.5 text-fg-muted">{tr.aiUi.consentUsage}</p>
            </div>
          ) : null}

          <div className="mt-3 flex justify-end gap-2">
            <Button variant="primary" data-testid="ai-sheet-confirm" onClick={confirm}>
              {needsConsent ? tr.aiUi.consentOk : tr.aiUi.done}
            </Button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  )
}
