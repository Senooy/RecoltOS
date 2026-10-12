/**
 * Initialization of the `prefs` domain (registry `bootstrap/services.ts`):
 * `prefs.json` store (atomic write), `prefs.changed` event, native theme kept in sync
 * (`nativeTheme.themeSource` follows `prefs.theme`; the window background follows via
 * `followNativeTheme`)
 * and interface language (`ui.language`, otherwise the Mac's first preferred language).
 */
import { app, nativeTheme } from 'electron'
import { langFromLocales, resolveLang, setLang, type Lang } from '../../shared/i18n/lang'
import type { Disposer, ServiceContext } from '../bootstrap/context'
import { getSystemLang, setSystemLang } from '../i18n'
import { userDataPaths } from '../library/paths'
import { createPrefsStore, setPrefsStore } from './store'

/**
 * System language: `RECOLTOS_LANG` (tests, captures), otherwise the first preferred language of
 * macOS (`getPreferredSystemLanguages`), otherwise the app locale. Outside Electron: French.
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
  // First launch, file set aside or repaired: the effective state is written to disk.
  if (store.repairedAtOpen) store.persist()
  // Outside Electron (tests under Node), `nativeTheme` is missing: the native theme is left alone.
  const syncNativeTheme = (theme: ReturnType<typeof store.get>['theme']) => {
    if (nativeTheme) nativeTheme.themeSource = theme
  }
  syncNativeTheme(store.get().theme)
  setSystemLang(detectSystemLang(ctx.flags.systemLang))
  setLang(resolveLang(store.get().ui.language, getSystemLang()))
  const off = store.onChange((next, previous) => {
    if (next.theme !== previous.theme) syncNativeTheme(next.theme)
    // Native menu, zod, media worker and extension follow `onLangChange`.
    setLang(resolveLang(next.ui.language, getSystemLang()))
    ctx.emit('prefs.changed', next)
  })
  return () => {
    off()
    setPrefsStore(null)
  }
}
