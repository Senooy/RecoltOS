/**
 * Textes du domaine `collection` : vue Collection, sous-collections, sélecteur de
 * collection réutilisable. Le namespace de base `collection` reste dans `base.ts`.
 */
import { plural } from '../plural'

export const collection = {
  collectionUi: {
    moreActions: 'Actions de la collection',
    titleLabel: 'Nom de la collection',
    moveTo: 'Déplacer dans…',
    moveToRoot: 'Aucune (racine)',
    subPlaceholder: 'Nom de la sous-collection',
    coverTitle: 'Changer la couverture',
    coverHint: 'Choisis l’élément affiché devant les autres.',
    coverAuto: 'Automatique (le plus récent)',
    pickerFilter: 'Filtrer les collections…',
    pickerEmpty: 'Aucune collection',
    pickerLabel: 'Choisir une collection',
    notFound: 'Cette collection n’existe plus.',
    exporting: 'Export en cours…',
    exported: 'Export terminé',
    subCount: (n: number) => `${n} ${plural(n, 'élément', 'éléments')}`,
    pillsLabel: 'Sous-collections',
  },
} as const
