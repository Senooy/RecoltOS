/**
 * Textes de l'extension (popup, menus contextuels, toasts, erreurs de synchro) en français
 * (tutoiement) et en anglais. Langue : celle transmise par l'app connectée (`hello.ack.lang`,
 * mémorisée dans `storage.local`), sinon `navigator.language` (français si `fr*`, sinon anglais).
 * Les textes du manifest (nom, description, titre du bouton) passent par `_locales/` : ils
 * suivent la langue du navigateur.
 */
import { isLang, langFromLocale, type Lang } from '../../../src/shared/i18n/lang'
import type { Widen } from '../../../src/shared/i18n/messages'
import { api } from './api'

const NB = '\u00a0'

export const extFr = {
  menu: {
    save: 'Enregistrer dans RecoltOS',
    saveTo: 'Enregistrer dans la collection',
    more: 'Autre collection…',
  },
  toast: {
    saved: 'Enregistré dans RecoltOS',
    duplicate: 'Déjà dans ta bibliothèque',
    addedTo: (c: string) => `Ajouté à ${c}`,
    queued: 'RecoltOS est fermé : ajouté au prochain lancement',
    bigNeedsApp: 'Ouvre RecoltOS pour enregistrer ce fichier volumineux',
    tooBig: 'Fichier trop volumineux (200 Mo au maximum)',
    hostMissing: 'Connecteur absent : ouvre RecoltOS une fois pour l’installer',
    videoStream: 'Cette vidéo se lit en flux : enregistre plutôt la publication',
    failed: (m: string) => `Enregistrement impossible : ${m}`,
    saveFailed: 'Enregistrement impossible',
    addToCollection: 'Ajouter à une collection',
    appClosed: 'RecoltOS est fermé',
    readFile: 'lecture du fichier',
    unsupportedPage: 'page non prise en charge',
    unknownTab: 'onglet inconnu',
    error: 'erreur',
  },
  status: {
    connecting: { label: 'Connexion…' },
    app_connected: { label: 'Connecté à RecoltOS' },
    app_closed: {
      label: 'RecoltOS fermé',
      hint: 'Tes enregistrements seront ajoutés au prochain lancement de RecoltOS.',
    },
    host_missing: {
      label: 'Connecteur absent',
      hint: 'Ouvre RecoltOS une fois pour installer le connecteur, puis rouvre ce panneau.',
    },
    host_forbidden: {
      label: 'Connecteur refusé',
      hint: 'Réinstalle le connecteur depuis RecoltOS › Réglages › Synchronisation.',
    },
    host_exited: {
      label: 'RecoltOS introuvable',
      hint: 'Le connecteur s’est arrêté. Vérifie que RecoltOS est installé, puis rouvre ce panneau.',
    },
    protocol_mismatch: {
      label: 'Mise à jour nécessaire',
      hint: 'L’extension et RecoltOS ne parlent pas la même version : mets-les à jour.',
    },
    stale: {
      label: 'Extension à recharger',
      hint: 'Ton extension est plus ancienne que celle fournie avec RecoltOS : retire-la puis charge le dossier RecoltOS.',
    },
  } as Record<string, { label: string; hint?: string }>,
  popup: {
    connecting: 'Connexion…',
    noPreview: 'Aperçu indisponible',
    title: 'Titre',
    savePage: 'Enregistrer la page',
    saveHere: 'Enregistrer ici',
    saveImage: 'Image principale seulement',
    collection: 'Collection',
    collections: 'Collections',
    searchCollection: 'Rechercher une collection',
    newCollection: '+ Nouvelle collection',
    newCollectionPrompt: 'Nom de la nouvelle collection',
    note: 'Note',
    notePlaceholder: 'Ajouter une note',
    syncNow: 'Synchroniser maintenant',
    syncRequested: 'Synchronisation demandée',
    grant: 'Autoriser l’accès aux sites',
    syncFooter: 'La synchro tourne en arrière-plan tant que ce navigateur est ouvert.',
  },
  syncLine: {
    permission: (name: string) => `${name} — accès au site à autoriser`,
    disabled: (name: string) => `${name} — désactivé dans RecoltOS`,
    notLoggedIn: (name: string) => `${name} — non connecté dans ce navigateur`,
    last: (name: string, rel: string) => `${name} — dernière synchro ${rel}`,
    connected: (name: string) => `${name} — connecté`,
  },
  time: {
    now: 'à l’instant',
    minutes: (m: number) => `il y a ${m}${NB}min`,
    hours: (h: number) => `il y a ${h}${NB}h`,
    yesterday: 'hier',
    days: (d: number) => `il y a ${d}${NB}jours`,
  },
  syncErrors: {
    timeout: 'délai dépassé',
    network: 'réseau',
    rateLimited: 'limite atteinte',
    refused: (status: number) => `requête refusée (${status})`,
    response: (status: number) => `réponse ${status}`,
    xBlocked:
      'X refuse la requête d’arrière-plan (404 sans corps) : signature x-client-transaction-id probablement exigée ; ouvre x.com/i/bookmarks dans le navigateur',
    xQueryNotFound: (op: string) => `X ne reconnaît plus l’opération ${op} (Query not found)`,
    xApiChanged: (status: number) => `X a changé son API (${status})`,
    igNoSession: 'session Instagram absente',
    igVerification: 'Instagram demande une vérification',
    igWait: 'Instagram demande d’attendre',
    cosmosNoSession: 'session Cosmos absente : connecte-toi sur cosmos.so dans ce navigateur',
    cosmosToken: (status: number) =>
      `jeton Cosmos illisible (/api/refresh-token, réponse ${status})`,
    cosmosExpired: 'session Cosmos expirée',
    cosmosApiChanged: (msg: string) => `Cosmos a changé son API : ${msg}`,
    alreadyRunning: 'déjà en cours',
    noPermission: 'autorisations d’hôte manquantes',
    noSession: 'aucune session dans ce navigateur',
    noTarget: 'aucune cible d’exécution',
    xConfigNetwork: 'configuration de X introuvable : x.com injoignable (réseau)',
    xConfigHome: (status: number) =>
      `configuration de X introuvable : page d’accueil illisible (HTTP ${status})`,
    xConfigNoEntry:
      'configuration de X introuvable : aucun script x-web (entry-client) dans la page x.com',
    xConfigNoOp: (op: string, scripts: number) =>
      `configuration de X introuvable : opération GraphQL « ${op} » absente des ${scripts} scripts du client web lus`,
  },
} as const

export const extEn: Widen<typeof extFr> = {
  menu: {
    save: 'Save to RecoltOS',
    saveTo: 'Save to Collection',
    more: 'Other Collection…',
  },
  toast: {
    saved: 'Saved to RecoltOS',
    duplicate: 'Already in your library',
    addedTo: (c: string) => `Added to ${c}`,
    queued: 'RecoltOS is closed: added at next launch',
    bigNeedsApp: 'Open RecoltOS to save this large file',
    tooBig: 'File too large (200 MB max)',
    hostMissing: 'Connector missing: open RecoltOS once to install it',
    videoStream: 'This video is streamed: save the post instead',
    failed: (m: string) => `Couldn’t save: ${m}`,
    saveFailed: 'Couldn’t save',
    addToCollection: 'Add to a collection',
    appClosed: 'RecoltOS is closed',
    readFile: 'reading the file',
    unsupportedPage: 'unsupported page',
    unknownTab: 'unknown tab',
    error: 'error',
  },
  status: {
    connecting: { label: 'Connecting…' },
    app_connected: { label: 'Connected to RecoltOS' },
    app_closed: {
      label: 'RecoltOS closed',
      hint: 'Your saves will be added the next time RecoltOS opens.',
    },
    host_missing: {
      label: 'Connector missing',
      hint: 'Open RecoltOS once to install the connector, then reopen this panel.',
    },
    host_forbidden: {
      label: 'Connector refused',
      hint: 'Reinstall the connector from RecoltOS › Settings › Sync.',
    },
    host_exited: {
      label: 'RecoltOS not found',
      hint: 'The connector stopped. Check that RecoltOS is installed, then reopen this panel.',
    },
    protocol_mismatch: {
      label: 'Update needed',
      hint: 'The extension and RecoltOS don’t speak the same version: update them.',
    },
    stale: {
      label: 'Extension needs reloading',
      hint: 'Your extension is older than the one bundled with RecoltOS: remove it, then load the RecoltOS folder.',
    },
  },
  popup: {
    connecting: 'Connecting…',
    noPreview: 'Preview unavailable',
    title: 'Title',
    savePage: 'Save Page',
    saveHere: 'Save Here',
    saveImage: 'Main Image Only',
    collection: 'Collection',
    collections: 'Collections',
    searchCollection: 'Search for a collection',
    newCollection: '+ New Collection',
    newCollectionPrompt: 'Name of the new collection',
    note: 'Note',
    notePlaceholder: 'Add a note',
    syncNow: 'Sync Now',
    syncRequested: 'Sync requested',
    grant: 'Allow Access to Sites',
    syncFooter: 'Sync runs in the background as long as this browser is open.',
  },
  syncLine: {
    permission: (name: string) => `${name} — site access needs your permission`,
    disabled: (name: string) => `${name} — turned off in RecoltOS`,
    notLoggedIn: (name: string) => `${name} — not signed in in this browser`,
    last: (name: string, rel: string) => `${name} — last synced ${rel}`,
    connected: (name: string) => `${name} — connected`,
  },
  time: {
    now: 'just now',
    minutes: (m: number) => `${m} min ago`,
    hours: (h: number) => `${h} h ago`,
    yesterday: 'yesterday',
    days: (d: number) => `${d} days ago`,
  },
  syncErrors: {
    timeout: 'timed out',
    network: 'network',
    rateLimited: 'limit reached',
    refused: (status: number) => `request refused (${status})`,
    response: (status: number) => `response ${status}`,
    xBlocked:
      'X is refusing the background request (404 without a body): the x-client-transaction-id signature is probably required; open x.com/i/bookmarks in the browser',
    xQueryNotFound: (op: string) => `X no longer recognizes the ${op} operation (Query not found)`,
    xApiChanged: (status: number) => `X changed its API (${status})`,
    igNoSession: 'no Instagram session',
    igVerification: 'Instagram is asking for a verification',
    igWait: 'Instagram is asking to wait',
    cosmosNoSession: 'no Cosmos session: sign in at cosmos.so in this browser',
    cosmosToken: (status: number) =>
      `unreadable Cosmos token (/api/refresh-token, response ${status})`,
    cosmosExpired: 'Cosmos session expired',
    cosmosApiChanged: (msg: string) => `Cosmos changed its API: ${msg}`,
    alreadyRunning: 'already running',
    noPermission: 'missing host permissions',
    noSession: 'no session in this browser',
    noTarget: 'no execution target',
    xConfigNetwork: 'X configuration not found: x.com unreachable (network)',
    xConfigHome: (status: number) =>
      `X configuration not found: unreadable home page (HTTP ${status})`,
    xConfigNoEntry: 'X configuration not found: no x-web script (entry-client) on the x.com page',
    xConfigNoOp: (op: string, scripts: number) =>
      `X configuration not found: GraphQL operation “${op}” missing from the ${scripts} web client scripts read`,
  },
}

export type ExtMessages = Widen<typeof extFr>

const CATALOGS: Record<Lang, ExtMessages> = { fr: extFr, en: extEn }
const STORAGE_KEY = 'uiLang'

let current: Lang = langFromLocale(typeof navigator !== 'undefined' ? navigator.language : '')

/** Langue active de l'extension. */
export function extLang(): Lang {
  return current
}

/** Change la langue (tests, popup) sans la mémoriser. */
export function setExtLang(lang: Lang): void {
  current = lang
}

/** Catalogue de la langue active. */
export function xt(): ExtMessages {
  return CATALOGS[current]
}

/** Langue transmise par l'app connectée : adoptée et mémorisée pour le popup et les pages. */
export async function rememberAppLang(lang: unknown): Promise<void> {
  if (!isLang(lang)) return
  current = lang
  try {
    await api().storage.local.set({ [STORAGE_KEY]: lang })
  } catch {
    // stockage indisponible : la langue reste valable pour ce contexte
  }
}

/** Relit la langue mémorisée (langue de l'app) et suit ses changements. */
export async function loadExtLang(): Promise<Lang> {
  try {
    const r = await api().storage.local.get(STORAGE_KEY)
    if (isLang(r[STORAGE_KEY])) current = r[STORAGE_KEY]
    api().storage.onChanged.addListener((changes, area) => {
      const v = changes[STORAGE_KEY]?.newValue
      if (area === 'local' && isLang(v)) current = v
    })
  } catch {
    // hors navigateur (tests) : langue du navigateur
  }
  return current
}
