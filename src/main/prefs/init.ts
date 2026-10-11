/**
 * Initialisation du domaine `prefs` (registre `bootstrap/services.ts`, possédé par WP-02) :
 * magasin `prefs.json` (écriture atomique), événement `prefs.changed`, thème natif synchronisé
 * (`nativeTheme.themeSource` suit `prefs.theme` ; le fond de fenêtre suit via `followNativeTheme`).
 */
import { nativeTheme } from 'electron'
import type { Disposer, ServiceContext } from '../bootstrap/context'
import { userDataPaths } from '../library/paths'
import { createPrefsStore, setPrefsStore } from './store'

export function initPrefs(ctx: ServiceContext): Disposer {
  const store = createPrefsStore({ file: userDataPaths(ctx.userData).prefs, log: ctx.log })
  setPrefsStore(store)
  nativeTheme.themeSource = store.get().theme
  const off = store.onChange((next, previous) => {
    if (next.theme !== previous.theme) nativeTheme.themeSource = next.theme
    ctx.emit('prefs.changed', next)
  })
  return () => {
    off()
    setPrefsStore(null)
  }
}
