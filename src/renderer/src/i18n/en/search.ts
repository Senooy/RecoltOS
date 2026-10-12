/** English texts for the `search` domain: Search page, filters, chips. */
import type { Widen } from '../../../../shared/i18n/messages'
import type { search as frSearch } from '../fr/search'

export const search: Widen<typeof frSearch> = {
  searchUi: {
    inputLabel: 'Search your library',
    prev: 'Previous collections',
    next: 'Next collections',
    removeFilter: (label: string) => `Remove the ${label} filter`,
    filtersActive: (n: number) => `${n} active filter${n === 1 ? '' : 's'}`,
    sources: {
      x: 'X',
      instagram: 'Instagram',
      cosmos: 'Cosmos',
      web: 'Web',
      capture: 'Capture',
      local: 'Files',
    },
    kinds: {
      image: 'Images',
      video: 'Videos',
      tweet: 'Posts',
      url: 'Pages',
    },
    periodChip: {
      '7d': 'Last 7 days',
      '30d': 'Last 30 days',
      '1y': 'Last year',
    },
    anyCollection: 'All',
    tagsPlaceholder: 'Add a tag…',
    colorChip: (hex: string) => `Color ${hex}`,
    moreTags: (n: number) => `+${n}`,
    recentLabel: 'Search again',
  },
}
