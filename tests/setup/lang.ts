/**
 * Langue des tests unitaires et renderer : français, comme les fixtures et les assertions
 * historiques. Node et happy-dom exposent `navigator.language = 'en-US'` : sans ce réglage,
 * l'extension partirait en anglais. Les tests de l'anglais changent de langue explicitement.
 */
import { setExtLang } from '../../extension/src/lib/i18n'
import { setLang } from '../../src/shared/i18n/lang'

setLang('fr')
setExtLang('fr')
