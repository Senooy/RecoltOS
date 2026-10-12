/**
 * Textes du domaine `viewer` : vue détail. Le namespace de base `viewer`
 * reste dans `base.ts` ; ce fichier ajoute `viewerUi`.
 */
export const viewer = {
  viewerUi: {
    label: 'Vue détail',
    counter: (i: number, n: number) => `${i} / ${n}`,
    zoom: 'Zoom',
    seek: 'Position de lecture',
    slide: (i: number, n: number) => `Slide ${i} sur ${n}`,
    prevSlide: 'Slide précédente',
    nextSlide: 'Slide suivante',
    openSource: 'Ouvrir le lien',
    techInfo: 'Infos techniques',
    format: 'Format',
    identifier: 'Identifiant',
    removeTag: (name: string) => `Retirer le tag ${name}`,
    removeCollection: (name: string) => `Retirer de ${name}`,
    tagSuggestions: 'Suggestions de tags',
    ocrShow: 'Afficher',
    ocrHide: 'Masquer',
    copyPrompt: 'Copier le prompt',
    aiUnavailable: 'Active un moteur IA dans Réglages › IA.',
    aiNone: 'Aucune description pour l’instant.',
    providers: { claude: 'Claude', codex: 'Codex', gatheros: 'GatherOS' } as Record<string, string>,
    sources: {
      x: 'X',
      instagram: 'Instagram',
      cosmos: 'Cosmos',
      web: 'Web',
      capture: 'Capture d’écran',
      local: 'Fichier',
    } as Record<string, string>,
    kinds: {
      image: 'Image',
      video: 'Vidéo',
      tweet: 'Post',
      url: 'Page',
    } as Record<string, string>,
    noteSaved: 'Note enregistrée',
    deleted: 'Déplacé dans la corbeille',
    downloaded: 'Fichier enregistré',
    notFound: 'Cet élément n’existe plus.',
    thread: 'Fil',
    pick: 'Pipette',
    pickFailed: 'Aucune couleur lisible à cet endroit',
  },
} as const
