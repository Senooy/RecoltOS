/**
 * Textes du domaine `sync` (WP-57, SYNC §7.2 en tutoiement, ERRATA §G.2 : sync en arrière-plan sans
 * onglet, Firefox prioritaire). Les libellés repris de `fte10a` vivent dans `base.ts`
 * (`settings.sync.*`) ; ici, tout ce qui est propre à RecoltOS.
 */
const NB = '\u00a0'

export type SyncPlatformKey = 'x' | 'instagram' | 'cosmos'

const SITE: Record<SyncPlatformKey, string> = {
  x: 'x.com',
  instagram: 'instagram.com',
  cosmos: 'cosmos.so',
}
const NAME: Record<SyncPlatformKey, string> = { x: 'X', instagram: 'Instagram', cosmos: 'Cosmos' }

export const sync = {
  syncUi: {
    names: NAME,
    sites: SITE,
    experimental: 'expérimental',
    line: {
      disabled: 'Désactivé',
      never: 'Jamais synchronisé',
      running: (n: number) => `Synchronisation…${n ? ` ${n}${NB}élément${n > 1 ? 's' : ''}` : ''}`,
      backfill: (n: number) =>
        `Récupération de l’historique…${n ? ` ${n}${NB}élément${n > 1 ? 's' : ''}` : ''}`,
      ok: (rel: string, n: number) =>
        `Dernière synchro ${rel} · ${n > 0 ? `${n}${NB}nouveau${n > 1 ? 'x' : ''}` : 'à jour'}`,
      browserClosed: 'Navigateur fermé : la synchro reprendra à son ouverture',
      notLoggedIn: (p: SyncPlatformKey, browser: string | null) =>
        `Connecte-toi à ${NAME[p]} dans ${browser ?? 'ton navigateur'}`,
      permissions: (p: SyncPlatformKey) =>
        `Autorise l’accès à ${SITE[p]} dans l’extension (bouton de l’extension › « Autoriser l’accès aux sites »)`,
      blocked: (p: SyncPlatformKey) =>
        p === 'x'
          ? 'X refuse la requête de l’extension : ouvre x.com/i/bookmarks (tes favoris y sont aussi récupérés), puis « Synchroniser maintenant »'
          : `${NAME[p]} refuse la requête de l’extension : ouvre ${SITE[p]} pour te reconnecter, puis « Synchroniser maintenant »`,
      authRequired: (p: SyncPlatformKey, browser: string | null) =>
        p === 'instagram'
          ? `Instagram demande une vérification : ouvre instagram.com dans ${browser ?? 'ton navigateur'}`
          : `Connecte-toi à ${NAME[p]} dans ${browser ?? 'ton navigateur'}`,
      rateLimited: (at: string | null) =>
        at ? `Limite atteinte : reprise vers ${at}` : 'Limite atteinte : reprise plus tard',
      budget: 'Quota du jour atteint : reprise demain',
      apiChanged: (p: SyncPlatformKey) =>
        `${NAME[p]} a modifié son site : mise à jour de RecoltOS nécessaire`,
      network: 'Erreur réseau : nouvel essai au prochain créneau',
      waiting: (p: SyncPlatformKey) => `En attente : ouvre ${SITE[p]} une fois`,
      imported: 'Activée dans GatherOS : active-la ici pour reprendre',
    },
    menu: {
      open: (p: SyncPlatformKey) => `Options de la synchro ${NAME[p]}`,
      now: 'Synchroniser maintenant',
      resync: 'Tout resynchroniser',
      backgroundTab: 'Ouvrir un onglet en arrière-plan si besoin',
      journal: 'Voir le journal',
    },
    learnMore: 'En savoir plus',
    unofficial: 'Synchronisation non officielle, via ta session de navigateur.',
    learnMoreText:
      'RecoltOS lit tes favoris comme si tu les faisais défiler, depuis l’extension de ton navigateur connecté, en arrière-plan et sans ouvrir d’onglet. Ce n’est pas une API officielle : X, Instagram ou Cosmos peuvent la bloquer ou limiter temporairement ton compte. RecoltOS ne publie, n’aime et ne supprime jamais rien, tes cookies ne quittent pas le navigateur, et la synchro ne tourne que lorsque ton navigateur est ouvert.',
    extension: {
      title: 'Extension navigateur',
      connected: (browsers: string) => `Connectée — ${browsers}`,
      missing: 'Non détectée',
      install: 'Installer l’extension…',
      background:
        'La synchro tourne en arrière-plan, sans onglet ouvert, tant que ton navigateur est ouvert.',
      browserClosed:
        'Ton navigateur est fermé ou l’extension n’est pas chargée : la synchro est en pause.',
      supported: 'Firefox, Chrome, Brave, Edge et Vivaldi. Safari n’est pas pris en charge.',
      stale: (v: string, b: string) =>
        `Ton extension (v${v}) est plus ancienne que celle fournie avec RecoltOS (v${b}) : retire-la puis charge à nouveau le dossier RecoltOS.`,
      gatheros:
        'GatherOS synchronise peut-être encore tes favoris : désactive sa synchro (Réglages › Syncing) et retire son extension avant d’activer Instagram.',
      reveal: 'Révéler le dossier',
      revealXpi: 'Révéler le fichier signé',
      repair: 'Réinstaller le connecteur',
      repaired: (n: number) => `Connecteur installé pour ${n}${NB}navigateur${n > 1 ? 's' : ''}`,
    },
    install: {
      title: 'Installer l’extension RecoltOS',
      firefox: 'Firefox',
      chromium: 'Chrome, Brave, Edge, Vivaldi',
      ffSignedTitle: 'Version signée (recommandée)',
      ffSigned1: 'Révèle le fichier .xpi signé, puis glisse-le dans une fenêtre de Firefox.',
      ffSigned2: 'Confirme l’ajout, puis épingle l’extension si tu veux.',
      ffNoSigned:
        'Aucune version signée n’est encore disponible : lance « pnpm run sign:firefox » avec tes clés d’API Mozilla (voir docs/extension.md), ou utilise le chargement temporaire.',
      ffTempTitle: 'Chargement temporaire (jusqu’au redémarrage de Firefox)',
      ffTemp1: 'Copie l’adresse about:debugging#/runtime/this-firefox et ouvre-la dans Firefox.',
      ffTemp2: 'Clique sur « Charger un module complémentaire temporaire… ».',
      ffTemp3: 'Choisis le fichier manifest.json du dossier RecoltOS.',
      cr1: 'Copie l’adresse chrome://extensions et ouvre-la dans ton navigateur.',
      cr2: 'Active le Mode développeur (en haut à droite).',
      cr3: 'Clique sur « Charger l’extension non empaquetée » et choisis le dossier RecoltOS.',
      copy: 'Copier l’adresse',
      copied: 'Adresse copiée',
      waiting: 'En attente de l’extension…',
      done: (b: string) => `Extension connectée dans ${b}`,
      close: 'Terminé',
    },
    activate: {
      title: (p: SyncPlatformKey) => `Activer la synchronisation ${NAME[p]}${NB}?`,
      risk1: (p: SyncPlatformKey) =>
        `RecoltOS lit tes ${p === 'x' ? 'favoris' : 'enregistrements'} ${NAME[p]} avec ta session de navigateur, en arrière-plan, sans ouvrir d’onglet.`,
      risk2:
        'Ce n’est pas une API officielle : le site peut bloquer la lecture ou limiter temporairement ton compte.',
      risk3:
        'RecoltOS ne publie, n’aime et ne supprime jamais rien ; tes cookies restent dans le navigateur.',
      backgroundTab: (p: SyncPlatformKey) =>
        `Si le site refuse la lecture en arrière-plan, autoriser RecoltOS à ouvrir un onglet ${NAME[p]} en arrière-plan (refermé aussitôt)`,
      gatherosBlock:
        'GatherOS synchronise peut-être encore tes enregistrements Instagram. Deux extensions qui interrogent Instagram doublent les requêtes et augmentent le risque de vérification du compte. Désactive Réglages › Syncing dans GatherOS et retire son extension de tes navigateurs.',
      done: 'C’est fait',
      anyway: 'Activer quand même',
      confirm: 'Activer',
      cancel: 'Annuler',
    },
    journal: {
      title: (p: SyncPlatformKey) => `Journal de la synchro ${NAME[p]}`,
      empty: 'Aucun run pour l’instant.',
      modes: {
        incremental: 'incrémental',
        backfill: 'historique',
        deep: 'complet',
        passive: 'passif',
      } as Record<string, string>,
      reasons: {
        schedule: 'planifié',
        manual: 'manuel',
        hint: 'favori',
        toggle: 'activation',
        import: 'import',
      } as Record<string, string>,
      targets: {
        background: 'arrière-plan',
        tab: 'onglet ouvert',
        created_tab: 'onglet créé',
      } as Record<string, string>,
      line: (pages: number, n: number) =>
        `${pages}${NB}page${pages > 1 ? 's' : ''} · ${n}${NB}nouveau${n > 1 ? 'x' : ''}`,
    },
    toast: {
      newItems: (n: number, p: SyncPlatformKey) =>
        p === 'x'
          ? `${n}${NB}nouveau${n > 1 ? 'x' : ''} favori${n > 1 ? 's' : ''} X`
          : `${n}${NB}nouvel${n > 1 ? 's' : ''} enregistrement${n > 1 ? 's' : ''} ${NAME[p]}`,
      recovered: (n: number) =>
        `${n}${NB}publication${n > 1 ? 's' : ''} plus ancienne${n > 1 ? 's' : ''} récupérée${n > 1 ? 's' : ''}`,
      review: 'Revoir',
    },
    review: {
      title: 'Publications récupérées',
      description:
        'Le backfill a retrouvé ces publications plus anciennes. Garde-les ou mets-les à la corbeille.',
      keep: 'Tout garder',
      trash: 'Tout mettre à la corbeille',
      trashed: (n: number) => `${n}${NB}élément${n > 1 ? 's' : ''} mis à la corbeille`,
    },
  },
} as const
