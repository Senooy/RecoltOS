/**
 * Textes du domaine `capture` (WP-34) : Réglages › Capture, guide de permission, retours de
 * capture, import (dépôt, coller, URL, menu du FAB). Les namespaces de base `capture` et
 * `settings.capture` (DESIGN §5.2) restent dans `base.ts`.
 */
import { plural } from '../plural'

export const capture = {
  captureUi: {
    desc: 'Configure le raccourci global de capture d’écran et l’endroit où atterrissent les captures. Le nouveau raccourci s’applique immédiatement.',
    recordHelp: 'Capture la prochaine combinaison de touches. Échap annule.',
    recording: 'Appuie sur la combinaison…',
    record: 'Modifier le raccourci global',
    reset: 'Réinitialiser',
    errors: {
      taken: 'Ce raccourci est déjà pris par une autre app.',
      reserved: 'Ce raccourci est réservé par macOS.',
      invalid: 'Ajoute au moins ⌘, ⌃ ou ⌥ à une touche.',
      unsupported: 'Combinaison non prise en charge.',
    } as Record<string, string>,
    saveAsWarning:
      'Raccourci global : il remplace « Enregistrer sous… » (⇧⌘S) dans les autres apps tant que RecoltOS tourne.',
    dropFolderEmpty: 'Bibliothèque seulement',
    dropError: (code: string) => `Dernière copie impossible (${code}).`,
    mode: 'Mode de capture',
    modes: { region: 'Zone', window: 'Fenêtre', screen: 'Écran' } as Record<string, string>,
    notify: 'Notification après capture',
    hideApp: 'Masquer RecoltOS pendant la capture',
    copy: 'Copier aussi dans le presse-papiers',
    permission: 'Enregistrement de l’écran',
    granted: 'Autorisé',
    denied: 'Non autorisé',
    openPane: 'Ouvrir les Réglages Système',
    recheck: 'Vérifier à nouveau',
    staleHint:
      'Si les captures ne montrent que le fond d’écran : retire RecoltOS de la liste avec le bouton −, relance l’app et réautorise-la.',
    guideTitle: 'Autorise l’enregistrement d’écran',
    guideBody:
      'Pour capturer l’écran, macOS demande l’autorisation « Enregistrement de l’écran et de l’audio système » (libellé exact selon ta version).',
    guideStep1: 'Ouvre les Réglages Système',
    guideStep2: (dev: boolean) =>
      dev ? 'Active Electron (ou ton terminal) dans la liste' : 'Active RecoltOS dans la liste',
    guideStep3: 'Reviens ici et relance RecoltOS',
    guideAdhoc:
      'Cette copie de RecoltOS est signée « ad hoc » : macOS ne retiendra pas l’autorisation d’une version à l’autre. Voir le guide de signature.',
    guideGranted: 'Autorisation accordée',
    retry: 'Réessayer la capture',
    view: 'Voir',
    undo: 'Annuler',
    cancelled: 'Capture annulée',
  },
  importUiMore: {
    report: (added: number, dup: number, failed: number) =>
      `${added} ${plural(added, 'ajouté', 'ajoutés')} · ${dup} ${plural(dup, 'doublon', 'doublons')} · ${failed} ${plural(failed, 'échec', 'échecs')}`,
    progress: (done: number, total: number) => `Import… ${done} / ${total}`,
    importFolder: 'Importer un dossier…',
    pasteUrl: 'Coller une URL…',
    addTo: (name: string) => `Ajouter à « ${name} »`,
    urlLabel: 'URL de la page ou du média',
    urlPlaceholder: 'https://…',
    urlAdd: 'Ajouter',
    urlInvalid: 'Entre une adresse http(s) valide.',
    urlFailed: 'Impossible de récupérer cette page.',
    nothingToPaste: 'Rien à coller : copie une image, un fichier ou une URL.',
  },
} as const
