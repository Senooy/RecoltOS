/**
 * Initialisation du domaine `prefs` (registre `bootstrap/services.ts`) :
 * magasin `prefs.json` (écriture atomique), événement `prefs.changed`, thème natif synchronisé
 * (`nativeTheme.themeSource` suit `prefs.theme` ; le fond de fenêtre suit via `followNativeTheme`)
 * et langue de l'interface (`ui.language`, sinon la première langue préférée du Mac).
 */
import { app, nativeTheme } from 'electron'
import { langFromLocales, resolveLang, setLang, type Lang } from '../../shared/i18n/lang'
import type { Disposer, ServiceContext } from '../bootstrap/context'
import { getSystemLang, setSystemLang } from '../i18n'
import { userDataPaths } from '../library/paths'
import { createPrefsStore, setPrefsStore } from './store'

/**
 * Langue du système : `RECOLTOS_LANG` (tests, captures) sinon la première langue préférée de
 * macOS (`getPreferredSystemLanguages`), sinon la locale de l'app. Hors Electron : français.
 */
export function detectSystemLang(override: Lang | null): Lang {
  if (override) return override
  try {
    const preferred = app.getPreferredSystemLanguages()
    return langFromLocales(preferred.length > 0 ? preferred : [app.getLocale()])
  } catch {
    return 'fr'
  }
}

export function initPrefs(ctx: ServiceContext): Disposer {
  const store = createPrefsStore({ file: userDataPaths(ctx.userData).prefs, log: ctx.log })
  setPrefsStore(store)
  // Premier lancement, fichier mis de côté ou réparé : on écrit l'état effectif sur disque.
  if (store.repairedAtOpen) store.persist()
  // Hors Electron (tests sous Node), `nativeTheme` est absent : le thème natif n'est alors pas touché.
  const syncNativeTheme = (theme: ReturnType<typeof store.get>['theme']) => {
    if (nativeTheme) nativeTheme.themeSource = theme
  }
  syncNativeTheme(store.get().theme)
  setSystemLang(detectSystemLang(ctx.flags.systemLang))
  setLang(resolveLang(store.get().ui.language, getSystemLang()))
  const off = store.onChange((next, previous) => {
    if (next.theme !== previous.theme) syncNativeTheme(next.theme)
    // Menu natif, zod, worker média et extension suivent `onLangChange`.
    setLang(resolveLang(next.ui.language, getSystemLang()))
    ctx.emit('prefs.changed', next)
  })
  return () => {
    off()
    setPrefsStore(null)
  }
}
