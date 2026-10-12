/** English texts for the `collection` domain: Collection view, subcollections, collection picker. */
import type { Widen } from '../../../../shared/i18n/messages'
import type { collection as frCollection } from '../fr/collection'
import { pluralEn } from '../plural'

export const collection: Widen<typeof frCollection> = {
  collectionUi: {
    moreActions: 'Collection actions',
    titleLabel: 'Collection name',
    moveTo: 'Move to…',
    moveToRoot: 'None (top level)',
    subPlaceholder: 'Subcollection name',
    coverTitle: 'Change Cover',
    coverHint: 'Choose the item shown in front of the others.',
    coverAuto: 'Automatic (most recent)',
    pickerFilter: 'Filter collections…',
    pickerEmpty: 'No collections',
    pickerLabel: 'Choose a collection',
    notFound: 'This collection no longer exists.',
    exporting: 'Exporting…',
    exported: 'Export complete',
    subCount: (n: number) => `${n} ${pluralEn(n, 'item', 'items')}`,
    pillsLabel: 'Subcollections',
  },
}
