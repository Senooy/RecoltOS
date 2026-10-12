/** English texts for the `color` domain: color filter and sort. */
import type { Widen } from '../../../../shared/i18n/messages'
import type { color as frColor } from '../fr/color'

export const color: Widen<typeof frColor> = {
  colorUi: {
    tolerance: 'Tolerance',
    names: {
      rouge: 'Red',
      orange: 'Orange',
      jaune: 'Yellow',
      vert: 'Green',
      turquoise: 'Turquoise',
      bleu: 'Blue',
      violet: 'Purple',
      rose: 'Pink',
      marron: 'Brown',
      noir: 'Black',
      gris: 'Gray',
      blanc: 'White',
    },
  },
}
