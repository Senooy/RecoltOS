/**
 * `ShortcutRecorder` (DESIGN §3.10, SPACES §2.2) : 3 key caps 24×22 (⌘ ⇧ S) ; clic = écoute de
 * la prochaine combinaison (Échap annule) ; accélérateur positionnel (`e.code`), libellé de la
 * touche imprimée (`getLayoutMap()`) ; application immédiate (`capture.setShortcut`), erreur inline.
 */
import { useEffect, useRef, useState } from 'react'
import { fr } from '../../i18n/fr'
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

  // Libellé recalculé depuis l'accélérateur stocké (autre disposition depuis le dernier réglage).
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
        if (r.error === 'unsupported') setError(fr.captureUi.errors.unsupported!)
        return
      }
      setRecording(false)
      void rpc('capture.setShortcut', { accel: r.accel, label: r.label })
        .then(async (res) => {
          if (res.ok) {
            setError(null)
            await usePrefs.getState().load()
          } else setError(fr.captureUi.errors[res.error ?? 'invalid'] ?? fr.errors.generic)
        })
        .catch((err: unknown) =>
          setError(err instanceof RpcError ? err.message : fr.errors.generic),
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
        aria-label={fr.captureUi.record}
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
            {fr.captureUi.recording}
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
        {recording ? fr.settings.capture.recordHint : fr.captureUi.recordHelp}
      </p>
      {error ? (
        <p className="mt-1 text-[11px] text-danger" data-testid="shortcut-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
