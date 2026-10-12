/** English texts for the `palette` domain: the ⌘K command palette. */
import type { Widen } from '../../../../shared/i18n/messages'
import type { palette as frPalette } from '../fr/palette'

export const palette: Widen<typeof frPalette> = {
  paletteUi: {
    label: 'Command Palette',
    escape: 'esc',
    noResults: 'No results',
    openItemFallback: 'The detail view is coming in a future version: searching for the item.',
    sourceNames: {
      x: 'X',
      instagram: 'Instagram',
      cosmos: 'Cosmos',
      web: 'Web',
      capture: 'Capture',
      local: 'File',
    },
    untitled: 'Untitled',
  },
}
