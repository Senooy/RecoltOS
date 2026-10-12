/** English texts for the `library` domain: Library page, tabs, sort, collections row. */
import type { Widen } from '../../../../shared/i18n/messages'
import type { library as frLibrary } from '../fr/library'
import { pluralEn } from '../plural'

export const library: Widen<typeof frLibrary> = {
  libraryUi: {
    tabsLabel: 'Library tabs',
    sortLabel: 'Sort',
    columns: (n: number) => `${n} ${pluralEn(n, 'column', 'columns')}`,
    collectionsLabel: 'Collections',
    newCollectionPlaceholder: 'Collection name',
    shuffle: 'Shuffle',
    emptySaved: 'No items saved in a collection',
  },
}
