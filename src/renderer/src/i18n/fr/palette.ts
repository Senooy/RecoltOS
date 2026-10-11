/**
 * Textes du domaine `palette` (WP-23) : palette ⌘K. Le namespace de base `palette`
 * (DESIGN §5.2 : libellés des 15 commandes) reste dans `base.ts`.
 */
export const palette = {
  paletteUi: {
    label: 'Palette de commandes',
    escape: 'esc',
    noResults: 'Aucun résultat',
    openItemFallback: 'La vue détail arrive dans une prochaine version : recherche de l’élément.',
    sourceNames: {
      x: 'X',
      instagram: 'Instagram',
      cosmos: 'Cosmos',
      web: 'Web',
      capture: 'Capture',
      local: 'Fichier',
    } as Record<string, string>,
    untitled: 'Sans titre',
  },
} as const
