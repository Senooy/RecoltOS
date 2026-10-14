/**
 * React root: `AppShell` shell + cross-cutting bridges (prefs, flush before close,
 * cleanup of the internal drag).
 */
import { useEffect, useState } from 'react'
import { installInternalDragCleanup } from './lib/dnd'
import { initLayoutMap } from './lib/shortcuts'
import { installSyncNotifier } from './features/sync/notifier'
import { useUiLang } from './i18n'
import { AppShell } from './shell/AppShell'
import { preloadScreensWhenIdle } from './shell/routes'
import { installFlushBridge } from './state/flush'
import { followPrefsChanges, usePrefs } from './state/prefs'

function useDarkTheme(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark')
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.dataset.theme === 'dark'),
    )
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

/** StrictMode runs effects twice in dev: the metric is written only once. */
let appMountedMarked = false

export function App() {
  const dark = useDarkTheme()
  // Language change: the shell is remounted (`key`), all text follows without restart.
  // Route, layer (Settings) and selection live in stores: they are kept.
  const lang = useUiLang()

  useEffect(() => {
    const disposers = [
      installFlushBridge(),
      installInternalDragCleanup(),
      followPrefsChanges(),
      installSyncNotifier(),
    ]
    void usePrefs.getState().load()
    void initLayoutMap()
    const onFocus = () => void initLayoutMap()
    window.addEventListener('focus', onFocus)
    if (!appMountedMarked) {
      appMountedMarked = true
      window.recolt?.perfMark('app-mounted')
      // Other screens loaded once the first grid is on screen (see `shell/routes.tsx`).
      setTimeout(preloadScreensWhenIdle, 1_200)
    }
    return () => {
      window.removeEventListener('focus', onFocus)
      for (const d of disposers) d()
    }
  }, [])

  return <AppShell key={lang} dark={dark} />
}
