/**
 * Textes du domaine `search` : page Recherche, filtres, chips. Le namespace de base
 * `search` reste dans `base.ts`.
 */
export const search = {
  searchUi: {
    inputLabel: 'Rechercher dans ta bibliothèque',
    prev: 'Collections précédentes',
    next: 'Collections suivantes',
    removeFilter: (label: string) => `Retirer le filtre ${label}`,
    filtersActive: (n: number) => `${n} filtre${n > 1 ? 's' : ''} actif${n > 1 ? 's' : ''}`,
    sources: {
      x: 'X',
      instagram: 'Instagram',
      cosmos: 'Cosmos',
      web: 'Web',
      capture: 'Capture',
      local: 'Fichiers',
    } as Record<string, string>,
    kinds: {
      image: 'Images',
      video: 'Vidéos',
      tweet: 'Posts',
      url: 'Pages',
    } as Record<string, string>,
    periodChip: {
      '7d': '7 derniers jours',
      '30d': '30 derniers jours',
      '1y': 'Dernière année',
    } as Record<string, string>,
    anyCollection: 'Toutes',
    tagsPlaceholder: 'Ajouter un tag…',
    colorChip: (hex: string) => `Couleur ${hex}`,
    moreTags: (n: number) => `+${n}`,
    recentLabel: 'Relancer la recherche',
  },
} as const
