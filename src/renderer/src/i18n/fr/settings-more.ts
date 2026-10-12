/**
 * Textes du domaine `settings-more` : Réglages › Tags, Stockage, Données, compléments
 * d'Apparence et d'À propos, export zip, instantanés et restauration.
 */
import { plural } from '../plural'

export const settingsMore = {
  settingsMoreUi: {
    snapshotDone: 'Instantané créé',
    // Tags
    tagsDesc: 'Renomme, fusionne ou supprime les tags de ta bibliothèque.',
    tagsEmpty: 'Aucun tag pour l’instant.',
    tagsNoMatch: 'Aucun tag ne correspond.',
    tagCount: (n: number) => `${n} ${plural(n, 'élément', 'éléments')}`,
    tagActions: (name: string) => `Actions du tag « ${name} »`,
    tagNewTitle: 'Nouveau tag',
    tagMergeTitle: (name: string) => `Fusionner « ${name} » avec…`,
    tagMergeDone: (into: string) => `Tags fusionnés dans « ${into} »`,
    tagDeleteTitle: (name: string) => `Supprimer le tag « ${name} » ?`,
    tagDeleteBody: 'Les éléments restent dans ta bibliothèque ; seul le tag disparaît.',
    tagCreated: (name: string) => `Tag « ${name} » créé`,
    // Stockage
    storageDesc: 'Place occupée par cette bibliothèque sur ton Mac.',
    storageTotal: (size: string) => `${size} au total`,
    storageOther: 'Base et divers',
    downloadRemoteDesc:
      'Avatars, images citées et diapositives des posts sont récupérés pour s’afficher hors ligne.',
    autoEmptyDesc: 'Les éléments de la corbeille partent dans la Corbeille de macOS.',
    regenDesc: 'Recalcule miniatures, grandes images, affiches et aperçus vidéo.',
    regenAction: 'Régénérer',
    regenStarted: (n: number) => `${n} ${plural(n, 'aperçu mis', 'aperçus mis')} en file d’attente`,
    emptyNowDesc: (n: number) =>
      n === 0
        ? 'La corbeille est vide.'
        : `${n} ${plural(n, 'élément', 'éléments')} dans la corbeille.`,
    emptyAction: 'Vider',
    // Données
    dataDesc: 'Sauvegarde, exporte ou restaure ta bibliothèque.',
    exportDesc: 'Originaux, base et métadonnées lisibles (items.jsonl) dans une seule archive.',
    exportAction: 'Exporter…',
    exportProgress: (done: string, total: string) => `Export : ${done} / ${total}`,
    snapshotsGroup: 'Instantanés',
    snapshotDesc: 'Copie de la base seule (les fichiers ne sont jamais modifiés).',
    snapshotAction: 'Créer',
    snapshotsEmpty: 'Aucun instantané pour l’instant.',
    restoreTitle: 'Restaurer cet instantané ?',
    restoreBody:
      'La base actuelle est d’abord mise de côté dans un instantané « avant restauration ». Les fichiers ne bougent pas.',
    restoreConfirm: 'Restaurer',
    restoreDone: 'Instantané restauré',
    reasons: {
      manual: 'manuel',
      daily: 'quotidien',
      'pre-import': 'avant import',
      'pre-purge': 'avant purge',
      'pre-restore': 'avant restauration',
    } as Record<string, string>,
    reasonPreMigration: (v: string) => `avant migration v${v}`,
    importDesc: 'Copie tes éléments, collections, tags et notes depuis GatherOS.',
    importAction: 'Importer…',
    openFolderDesc: 'Dossier de la bibliothèque active dans le Finder.',
    openFolderAction: 'Ouvrir',
    verifyAction: 'Vérifier la bibliothèque',
    verifyOk: 'Bibliothèque vérifiée : aucun problème.',
    verifyIssues: (n: number) => `${n} ${plural(n, 'problème trouvé', 'problèmes trouvés')}`,
    // À propos
    licensesTitle: 'Licences open source',
    licensesBody:
      'RecoltOS s’appuie sur Electron, React, SQLite (better-sqlite3), sharp, Radix UI, cmdk, Tailwind CSS, lucide, motion, zod, zustand et yazl, sous licences MIT, Apache 2.0, BSD ou ISC.',
  },
} as const
