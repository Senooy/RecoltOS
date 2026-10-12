/**
 * Language for unit and renderer tests: French, like the fixtures and the assertions
 * historical ones. Node and happy-dom expose `navigator.language = 'en-US'`: without this setting,
 * the extension would start in English. The English tests switch language explicitly.
 */
import { setExtLang } from '../../extension/src/lib/i18n'
import { setLang } from '../../src/shared/i18n/lang'

setLang('fr')
setExtLang('fr')
