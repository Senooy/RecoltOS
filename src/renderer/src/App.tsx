/**
 * Racine React : coque `AppShell` (WP-13) + ponts transverses (prefs, vidage avant fermeture,
 * nettoyage du glisser interne).
 */
import { useEffect, useState } from 'react'
import { installInternalDragCleanup } from './lib/dnd'
import { initLayoutMap } from './lib/shortcuts'
import { AppShell } from './shell/AppShell'
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

/** StrictMode exécute les effets deux fois en dev : la métrique n'est écrite qu'une fois. */
let appMountedMarked = false

export function App() {
  const dark = useDarkTheme()

  useEffect(() => {
    const disposers = [installFlushBridge(), installInternalDragCleanup(), followPrefsChanges()]
    void usePrefs.getState().load()
    void initLayoutMap()
    const onFocus = () => void initLayoutMap()
    window.addEventListener('focus', onFocus)
    if (!appMountedMarked) {
      appMountedMarked = true
      window.recolt?.perfMark('app-mounted')
    }
    return () => {
      window.removeEventListener('focus', onFocus)
      for (const d of disposers) d()
    }
  }, [])

  return <AppShell dark={dark} />
}
