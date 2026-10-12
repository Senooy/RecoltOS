/** English texts for the `grid` domain: grid, cards, context menu. */
import type { Widen } from '../../../../shared/i18n/messages'
import type { grid as frGrid } from '../fr/grid'

export const grid: Widen<typeof frGrid> = {
  gridUi: {
    label: 'Items',
    loading: 'Loading items…',
    dragPanelTitle: 'Collections',
    dragPanelLabel: 'Drop into a collection',
    alreadyIn: (c: string) => `Already in ${c}`,
  },
}
