/**
 * Textes du domaine `library` (WP-15) : page Bibliothèque, onglets, tri, rangée de collections.
 */
import { plural } from '../plural'

export const library = {
  libraryUi: {
    tabsLabel: 'Onglets de la bibliothèque',
    sortLabel: 'Trier',
    columns: (n: number) => `${n} ${plural(n, 'colonne', 'colonnes')}`,
    collectionsLabel: 'Collections',
    newCollectionPlaceholder: 'Nom de la collection',
    shuffle: 'Mélanger',
    emptySaved: 'Aucun élément rangé dans une collection',
  },
} as const
