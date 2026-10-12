/**
 * `ShortcutRecorder`: 3 key caps 24×22 (⌘ ⇧ S); click = listens for
 * the next combination (Esc cancels); positional accelerator (`e.code`), label of the
 * printed key (`getLayoutMap()`); immediate application (`capture.setShortcut`), inline error.
 */
import { useEffect, useRef, useState } from 'react'
import { tr } from '../../i18n'
import { cn } from '../../lib/cn'
import { RpcError, rpc } from '../../lib/rpc'
import { usePrefs } from '../../state/prefs'
import { accelKeyToCode, accelToCaps, eventToAccelerator } from './keymap'

async function layoutMap(): Promise<Map<string, string> | null> {
  const kb = (
    navigator as Navigator & { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }
  ).keyboard
  try {
    return kb ? await kb.getLayoutMap() : null
  } catch {
    return null
  }
}

export function ShortcutRecorder() {
  const accel = usePrefs((s) => s.prefs.capture.shortcut)
  const label = usePrefs((s) => s.prefs.capture.shortcutLabel)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const layout = useRef<Map<string, string> | null>(null)
  const btn = useRef<HTMLButtonElement | null>(null)

  // Label recomputed from the stored accelerator (different layout since the last setting).
  useEffect(() => {
    void layoutMap().then((m) => {
      layout.current = m
      const code = accelKeyToCode(accel.split('+').at(-1) ?? '')
      const printed = code ? m?.get(code)?.toUpperCase() : undefined
      if (printed && printed.length === 1 && printed !== label) {
        void rpc('capture.setShortcut', { accel, label: printed })
          .then(() => usePrefs.getState().load())
          .catch(() => undefined)
      }
    })
  }, [accel, label])

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setRecording(false)
        return
      }
      const r = eventToAccelerator(e, layout.current)
      if ('error' in r) {
        if (r.error === 'unsupported') setError(tr.captureUi.errors.unsupported!)
        return
      }
      setRecording(false)
      void rpc('capture.setShortcut', { accel: r.accel, label: r.label })
        .then(async (res) => {
          if (res.ok) {
            setError(null)
            await usePrefs.getState().load()
          } else setError(tr.captureUi.errors[res.error ?? 'invalid'] ?? tr.errors.generic)
        })
        .catch((err: unknown) =>
          setError(err instanceof RpcError ? err.message : tr.errors.generic),
        )
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording])

  const caps = accelToCaps(accel, label)
  return (
    <div>
      <button
        ref={btn}
        type="button"
        data-testid="shortcut-recorder"
        aria-label={tr.captureUi.record}
        aria-pressed={recording}
        className={cn(
          'flex items-center gap-[5px] rounded-md outline-none',
          recording && 'shortcut-recording',
        )}
        onClick={() => {
          setError(null)
          setRecording((r) => !r)
        }}
      >
        {recording ? (
          <span className="flex h-[22px] items-center rounded-md border border-dashed border-[var(--accent-blue)] px-2 text-[11px] text-fg-muted">
            {tr.captureUi.recording}
          </span>
        ) : (
          caps.map((c, i) => (
            <kbd key={i} className="capture-cap" data-testid="shortcut-cap">
              {c}
            </kbd>
          ))
        )}
      </button>
      <p className="mt-[6px] text-[11px] text-[var(--set-help)]">
        {recording ? tr.settings.capture.recordHint : tr.captureUi.recordHelp}
      </p>
      {error ? (
        <p className="mt-1 text-[11px] text-danger" data-testid="shortcut-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
