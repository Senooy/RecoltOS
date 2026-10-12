/**
 * Textes du domaine `shell` : coque, sélecteur de bibliothèque, dialogues génériques.
 */
export const shell = {
  shell: {
    create: 'Créer',
    rename: 'Renommer',
    cancel: 'Annuler',
    confirm: 'Confirmer',
    name: 'Nom',
    librariesHeading: 'Bibliothèques',
    newLibraryTitle: 'Nouvelle bibliothèque',
    newLibraryDefault: 'Ma bibliothèque',
    selectionClear: 'Tout désélectionner',
    addTo: 'Ajouter à…',
    hide: 'Masquer',
    download: 'Télécharger',
    delete: 'Supprimer',
    restore: 'Restaurer',
    deleteForever: 'Supprimer définitivement',
    dropCollection: 'Déposer dans la collection',
    unavailable: 'Pas encore disponible dans cette version.',
  },
  /** Libellés internes du kit UI (`components/ui/labels.ts`). */
  uiKit: {
    remove: (label: string) => `Retirer ${label}`,
    slide: (current: number, total: number) => `Diapositive ${current} sur ${total}`,
    notifications: 'Notifications',
    dismiss: 'Ignorer la notification',
    canvas: 'Toile',
    recentSearch: (label: string, q: string) => `${label} « ${q} »`,
  },
} as const
