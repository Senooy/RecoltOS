/**
 * Textes du domaine `ai` : Réglages › IA, feuille « Changer » (fournisseur et
 * consentement), boîte « Enrichir la bibliothèque », aperçu de l'envoi, journal, panneau Détails,
 * pastille de la barre du haut. Les namespaces de base `ai` et `settings.ai` restent dans `base.ts`.
 * Tutoiement, typographie FR (espaces insécables via `lib/format.ts` quand c'est calculé).
 */
import { plural } from '../plural'

const NNBSP = ' '

export const ai = {
  aiUi: {
    engineTitle: (name: string) => `Moteur${NNBSP}: ${name}`,
    engineNone: 'aucun',
    providerNames: { claude: 'Claude', codex: 'ChatGPT / Codex', off: 'Aucun' } as Record<
      string,
      string
    >,
    shortNames: { claude: 'Claude', codex: 'Codex' } as Record<string, string>,
    change: 'Changer',
    state: {
      off: 'L’IA est désactivée. Choisis un moteur pour titrer, décrire et taguer tes éléments.',
      noConsent: 'Moteur choisi, en attente de ton accord sur ce qui est envoyé.',
      checking: 'Vérification…',
      notFound: 'CLI introuvable sur ce Mac.',
      notLogged: 'Non connecté : lance la CLI une fois dans le Terminal pour te connecter.',
      connected: (plan?: string) =>
        plan
          ? `Connecté · plan ${plan === 'max' ? 'Max' : plan === 'pro' ? 'Pro' : plan}`
          : 'Connecté',
      apiKey: 'Clé API détectée : facturation à l’usage, contraire à ton choix d’abonnement.',
      paused: (reason: string, until?: string) => `${reason}${until ? ` jusqu’à ${until}` : ''}`,
    },
    pauseReasons: {
      RATE_LIMITED: 'Limite de l’abonnement atteinte, en pause',
      NOT_AUTHENTICATED: 'Non connecté, en pause',
      NOT_INSTALLED: 'CLI introuvable, en pause',
      HARD_CAP: 'Plafond quotidien atteint',
      USER: 'En pause',
      HOUR_BUDGET: 'Quota horaire atteint',
      DAY_BUDGET: 'Quota du jour atteint',
    } as Record<string, string>,
    autoName: 'Nommer automatiquement les nouveaux ajouts',
    autoNameDesc: 'Génère un titre court pour chaque nouvel élément, en arrière-plan.',
    autoAnalyze: 'Décrire et taguer les nouveaux ajouts',
    autoAnalyzeDesc:
      'Ajoute une description, des tags et le texte détecté (OCR) pour que la recherche trouve tes éléments par leur contenu.',
    advanced: 'Avancé',
    privacy: 'Confidentialité',
    model: 'Modèle',
    modelAuto: 'Auto',
    modelCustom: 'Autre…',
    modelPlaceholder: 'identifiant du modèle',
    effort: 'Effort',
    efforts: { low: 'Faible', medium: 'Moyen' } as Record<string, string>,
    fallback: 'Moteur de secours',
    fallbackHelp: 'Utilisé quand le moteur principal est en pause (limite, déconnexion).',
    titlePolicy: 'Remplacer les titres',
    titlePolicies: { empty: 'Seulement si vide', always: 'Toujours' } as Record<string, string>,
    rate: 'Débit',
    rateHelp: (h: number, d: number, hard: number) =>
      `${h} appels par heure, ${d} par jour, plafond dur ${hard}.`,
    presets: { soft: 'Doux', normal: 'Normal', fast: 'Rapide' } as Record<string, string>,
    concurrency: 'Appels simultanés',
    queue: 'File',
    queueStats: (q: number, r: number, f: number) =>
      `${q} en attente · ${r} en cours · ${f} ${plural(f, 'échec', 'échecs')}`,
    budgetUsed: (h: number, hl: number, d: number, dl: number) =>
      `Cette heure ${h}/${hl} · aujourd’hui ${d}/${dl}`,
    pause: 'Pause',
    resume: 'Reprendre',
    cancelAll: 'Annuler tout',
    retryFailed: 'Relancer les échecs',
    overrideCap: 'Continuer aujourd’hui',
    analyzeRest: (n: number) => `Analyser les éléments non analysés (${n})`,
    regenerateFr: (n: number) => `Régénérer en français les descriptions existantes (${n})`,
    sentTitle: 'Ce qui est envoyé',
    sentRows: [
      [
        'Image, page',
        '1 JPEG ≤ 1568 px sans EXIF, hôte de la source, titre de page, légende du post (≤ 600 car.) avec nom et pseudo de l’auteur',
      ],
      [
        'Carrousel',
        '1 à 3 JPEG (couverture et diapositives réparties), nombre de diapositives, légende',
      ],
      [
        'Vidéo',
        '3 images clés ≤ 1024 px, durée, légende et auteur ; jamais le fichier vidéo ni le son',
      ],
      ['Post', 'auteur, pseudo, texte (≤ 1200 car.) et post cité (≤ 600 car.)'],
      ['Toujours', 'le prompt système et ≤ 60 tags de ton vocabulaire'],
    ] as [string, string][],
    neverSent:
      'Jamais envoyés : chemins locaux, noms de fichiers d’origine, URL complètes, notes, collections, le reste de la bibliothèque.',
    preview: 'Voir un aperçu',
    log: 'Journal des envois',
    logEmpty: 'Aucun envoi pour l’instant.',
    logClear: 'Effacer le journal',
    logCleared: (n: number) => `${n} ${plural(n, 'entrée effacée', 'entrées effacées')}`,
    outcomes: {
      ok: 'réussi',
      error: 'erreur',
      rate_limited: 'limite',
      cancelled: 'annulé',
      timeout: 'délai',
      violation: 'outil refusé',
    } as Record<string, string>,
    logFiles: (n: number, kb: string) => (n === 0 ? 'texte seul' : `${n} JPEG · ${kb}`),
    // Feuille « Changer »
    sheetTitle: 'Moteur IA',
    sheetDesc:
      'RecoltOS lance la CLI officielle installée sur ton Mac, avec ton abonnement. Aucune clé API.',
    path: 'Chemin',
    copies: (n: number) => `${n} ${plural(n, 'copie trouvée', 'copies trouvées')}`,
    version: (v: string) => `version ${v}`,
    verify: 'Vérifier',
    liveTest: 'Tester un vrai appel',
    liveTestHint: 'Consomme 1 requête de ton abonnement (image synthétique).',
    liveOk: (ms: number, model?: string) =>
      `Réponse conforme en ${String(Math.round(ms / 100) / 10).replace('.', ',')}${NNBSP}s${model ? ` (${model})` : ''}`,
    liveFail: (e: string) => `Échec : ${e}`,
    keychainHint:
      'Si macOS demande l’accès au trousseau pour « claude », clique sur « Toujours autoriser ».',
    consentTitle: 'Avant d’utiliser l’IA',
    consentIntro: (name: string) =>
      `Les éléments analysés sont envoyés à ${name}, sous ton abonnement, et soumis aux conditions et à la politique de confidentialité ${name === 'Claude' ? 'd’Anthropic' : 'd’OpenAI'}.`,
    consentThirdParty: 'Les légendes et les noms d’auteurs de tiers partent avec le contenu.',
    consentUsage:
      'Usage personnel, avec le binaire officiel non modifié et ton propre compte : les limites des abonnements supposent un usage ordinaire et individuel. Ne distribue pas RecoltOS configuré sur le compte de quelqu’un d’autre.',
    consentOk: 'J’ai compris',
    done: 'OK',
    // Enrichir
    enrichDesc: (n: number) =>
      `${n} ${plural(n, 'élément n’a', 'éléments n’ont')} pas encore de description. L’IA peut les titrer, les décrire et les taguer pour la recherche.`,
    enrichEta: (calls: number, eta: string, perHour: number) =>
      `${calls} ${plural(calls, 'appel', 'appels')}, environ ${eta} à ${perHour} appels par heure.`,
    enrichRegen: (n: number) =>
      `Régénérer aussi en français les ${n} descriptions existantes (consomme ${n} appels de plus)`,
    enrichXCarousels: 'Carrousels X sans diapositives locales : couverture seule.',
    enrichStart: 'Lancer',
    enrichLater: 'Plus tard',
    enrichStarted: (n: number) =>
      `${n} ${plural(n, 'élément ajouté', 'éléments ajoutés')} à la file IA`,
    // Aperçu
    previewTitle: 'Ce qui sera envoyé',
    previewDesc: (name: string) => `Exactement ces fichiers et ce texte, vers ${name}.`,
    previewNoFile: 'Aucune image : texte seul.',
    previewPrompt: 'Prompt',
    previewSystem: 'Prompt système',
    previewChars: (n: number) => `${n} caractères`,
    previewEmpty: 'Aucun élément à prévisualiser.',
    // Détails
    via: (name: string, fallback: boolean) =>
      `via ${name} (abonnement)${fallback ? ' · secours' : ''}`,
    generating: 'Analyse en cours…',
    queued: 'En file d’attente…',
    failed: 'L’analyse a échoué.',
    retry: 'Réessayer',
    excluded: 'Exclu de l’IA',
    generatePrompt: 'Générer un prompt d’image',
    copied: 'Prompt copié',
    enqueued: 'Analyse demandée',
    include: 'Autoriser l’envoi à l’IA',
    // Barre du haut
    pill: (n: number) => `IA · ${n}`,
    pillPaused: 'IA en pause',
    pillTitle: 'File IA : ouvrir Réglages › IA',
    eta: (sec: number) => {
      if (sec < 90) return `${Math.max(1, Math.round(sec))}${NNBSP}s`
      const min = Math.round(sec / 60)
      if (min < 60) return `${min}${NNBSP}min`
      const h = Math.floor(min / 60)
      const m = min % 60
      return m ? `${h}${NNBSP}h${NNBSP}${String(m).padStart(2, '0')}` : `${h}${NNBSP}h`
    },
    errors: {
      ai_disabled: 'Choisis d’abord un moteur dans Réglages › IA.',
      ai_consent_required: 'Accepte d’abord les conditions d’envoi dans Réglages › IA.',
    } as Record<string, string>,
  },
} as const
