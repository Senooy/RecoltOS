/**
 * Textes du domaine `grid` : grille, cartes, menu contextuel (complète `card` et `menu`).
 */
export const grid = {
  gridUi: {
    label: 'Éléments',
    loading: 'Chargement des éléments…',
    /** Panneau des collections pendant le glisser d'une carte (bord droit). */
    dragPanelTitle: 'Collections',
    dragPanelLabel: 'Déposer dans une collection',
    alreadyIn: (c: string) => `Déjà dans ${c}`,
  },
} as const
