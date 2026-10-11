/**
 * Handlers `prefs.*` (WP-02) : lecture et patch profond des préférences. L'entrée est déjà validée
 * par `PrefsPatchInput` (clés réservées refusées) ; `mergePrefs` revalide l'ensemble.
 */
import { requirePrefsStore } from '../../prefs/store'
import type { DomainHandlers } from '../router'

export const prefsHandlers: DomainHandlers<'prefs'> = {
  'prefs.get': () => requirePrefsStore().get(),
  'prefs.set': ({ patch }) => requirePrefsStore().set(patch),
}
