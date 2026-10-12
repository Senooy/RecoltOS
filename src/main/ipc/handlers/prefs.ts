/**
 * Handlers `prefs.*`: reading and deep patching of the preferences. The input is already validated
 * by `PrefsPatchInput` (reserved keys refused); `mergePrefs` re-validates the whole set.
 */
import { requirePrefsStore } from '../../prefs/store'
import type { DomainHandlers } from '../router'

export const prefsHandlers: DomainHandlers<'prefs'> = {
  'prefs.get': () => requirePrefsStore().get(),
  'prefs.set': ({ patch }) => requirePrefsStore().set(patch),
}
