/**
 * Textes du domaine `color` : filtre et tri par couleur.
 */
export const color = {
  colorUi: {
    tolerance: 'Tolérance',
    /** Name of each filter colour, by `NamedColor.id`. */
    names: {
      rouge: 'Rouge',
      orange: 'Orange',
      jaune: 'Jaune',
      vert: 'Vert',
      turquoise: 'Turquoise',
      bleu: 'Bleu',
      violet: 'Violet',
      rose: 'Rose',
      marron: 'Marron',
      noir: 'Noir',
      gris: 'Gris',
      blanc: 'Blanc',
    } as Record<string, string>,
  },
} as const
