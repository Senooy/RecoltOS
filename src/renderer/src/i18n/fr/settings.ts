/**
 * Textes du domaine `settings` (WP-16) : modale Réglages, section Bibliothèques, import GatherOS.
 */
import { plural } from '../plural'

const n = (k: number, one: string, many: string) => `${k} ${plural(k, one, many)}`

export const settings = {
  settingsUi: {
    placeholder: 'Cette section arrive dans une prochaine version.',
    libraryMenu: 'Actions de la bibliothèque',
    active: 'Active',
    switchTo: 'Ouvrir',
    reveal: 'Afficher dans le Finder',
    remove: 'Retirer de la liste',
    removeTitle: (name: string) => `Retirer « ${name} » de la liste ?`,
    removeBody: 'Le dossier et ses fichiers restent sur ton Mac.',
    itemsAndSize: (items: number, size: string) => `${n(items, 'élément', 'éléments')} · ${size}`,
  },
  importUi: {
    detecting: 'Recherche de GatherOS…',
    notFound: 'Aucune bibliothèque GatherOS trouvée sur ce Mac.',
    found: (name: string) => `Bibliothèque GatherOS trouvée : ${name}`,
    summary: (items: number, images: number, videos: number, posts: number, links: number) =>
      `${n(items, 'élément importable', 'éléments importables')} (${n(images, 'image', 'images')}, ${n(videos, 'vidéo', 'vidéos')}, ${n(posts, 'post', 'posts')}, ${n(links, 'lien', 'liens')})`,
    collectionsAndSize: (c: number, size: string) =>
      `${n(c, 'collection', 'collections')}, ${size}`,
    running: 'Quitte GatherOS pour importer.',
    retry: 'Réessayer',
    options: 'Options',
    includeTrash: (k: number) => `Inclure la corbeille (${k})`,
    includeHidden: (k: number) => `Inclure les masqués (${k})`,
    aiFields: 'Reprendre titres, descriptions et OCR',
    prefs: 'Reprendre aussi mes réglages GatherOS (le fournisseur IA reste désactivé)',
    skipStarter: (k: number) => `Ignorer les exemples de démarrage (${k})`,
    advanced: 'Avancé',
    ignoreTombstones: 'Recréer les éléments supprimés depuis le dernier import',
    target: 'Cible',
    targetActive: 'Bibliothèque active',
    targetNew: 'Nouvelle bibliothèque « Importée de GatherOS »',
    start: 'Importer',
    cancel: 'Annuler',
    close: 'Fermer',
    phases: {
      detect: 'Détection',
      snapshot: 'Copie de la base',
      plan: 'Préparation',
      authors: 'Auteurs',
      items: 'Base',
      files: 'Fichiers',
      collections: 'Collections',
      tags: 'Tags',
      tombstones: 'Éléments rejetés',
      jobs: 'Médias distants et avatars',
      finalize: 'Finalisation',
      done: 'Terminé',
    } as Record<string, string>,
    derived: (d: number, t: number) => `Aperçus : ${d} / ${t}`,
    doneTitle: 'Import terminé',
    cancelled: 'Import annulé.',
    failed: 'L’import a échoué.',
    counts: (items: number, collections: number, skipped: number) =>
      `${n(items, 'élément importé', 'éléments importés')}, ${n(collections, 'collection', 'collections')}, ${n(skipped, 'déjà présent', 'déjà présents')}`,
    missingFiles: (k: number) => `Voir les éléments sans fichier (${k})`,
    urlDuplicates: (k: number) => `Voir les doublons d’URL (${k})`,
    openReport: 'Ouvrir le rapport',
    enrich: (k: number) => `Enrichir ${n(k, 'élément', 'éléments')} avec l’IA…`,
    enrichOff: 'Active d’abord un moteur dans Réglages › IA.',
    goAi: 'Réglages › IA',
    resumeTitle: 'Un import GatherOS a été interrompu',
    resume: 'Reprendre l’import',
    duplicatesTitle: 'Doublons d’URL',
    missingTitle: 'Éléments sans fichier',
  },
} as const
