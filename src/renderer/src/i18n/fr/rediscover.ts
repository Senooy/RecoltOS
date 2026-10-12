/**
 * Textes du domaine `rediscover`. Le namespace de base `rediscover` reste
 * dans `base.ts` ; ce fichier ajoute `rediscoverUi`.
 */
export const rediscover = {
  rediscoverUi: {
    label: 'Redécouvrir',
    close: 'Quitter Redécouvrir',
    suggested: 'Récentes',
    all: 'Toutes les collections',
    filter: 'Filtrer…',
    newCollection: 'Nouvelle collection…',
    kept: 'Gardé',
    trashed: 'Déplacé dans la corbeille',
    addedTo: (name: string) => `Ajouté à ${name}`,
    skipped: 'Passé',
    undone: 'Action annulée',
    nothingToUndo: 'Rien à annuler',
    empty: 'Rien à redécouvrir pour l’instant.',
  },
} as const
