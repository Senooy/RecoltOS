# Checklist manuelle signée

Ce que les tests automatiques ne peuvent pas prouver (permissions TCC, comptes réels, matériel).
À dérouler sur le **build packagé signé** (`pnpm run dist` puis `pnpm run app:install`), avant chaque tag de
jalon concerné et avant `v0.1.0` (PLAN §8, QA §6.7). Chaque passage est daté et initialé par l'utilisateur :
une case n'est cochée que si le comportement a été vu, jamais déduit.

- **Passage** : date `____-__-__` · build `________` · signature `RecoltOS Local` / ad hoc · initiales `____`
- **Précondition** : GatherOS quitté, sa sync et son extension désactivées ; `RECOLTOS_USER_DATA` non défini.

## 1. Capture d'écran (M3, SPACES §8.2)

Préparation (une fois) : `RECOLTOS_SIGN_IDENTITY="RecoltOS Local" pnpm run pack` puis
`pnpm run app:install`, lancer `/Applications/RecoltOS.app`, faire ⌘⇧S : macOS affiche l'invite
« Enregistrement de l'écran » (ou le guide RecoltOS s'ouvre) → Réglages Système › Confidentialité et
sécurité › Enregistrement de l'écran et de l'audio système → activer **RecoltOS** → « Relancer
RecoltOS ». Pour recommencer à zéro : `tccutil reset ScreenCapture com.recoltos.app`.

- [ ] ⌘⇧S global déclenche la capture, app au premier plan et en arrière-plan.
- [ ] Mode région : sélection à la souris, Échap annule, l'élément apparaît dans la bibliothèque.
- [ ] Dossier de dépôt : choisir le Bureau déclenche l'invite d'accès ; le fichier PNG y est écrit.
- [ ] L'invite « Enregistrement d'écran » n'apparaît **qu'une fois** ; elle ne revient pas après un second build signé avec la même identité.
- [ ] Raccourci modifié à chaud ; avec GatherOS ouvert, le message d'erreur de conflit est en français.
- [ ] Raccourci sur une lettre en AZERTY : le libellé affiché correspond à la touche réellement pressée.
- [ ] Toutes fenêtres fermées (⌘W) : ⌘⇧S capture toujours ; la notification « Capture ajoutée » est cliquable et rouvre l'élément dans une fenêtre recréée.
- [ ] ⌃ pendant la sélection : l'image est prise depuis le presse-papiers.
- [ ] Capture d'une image déjà présente : « Déjà dans la bibliothèque ».
- [ ] Réglages › Capture : « Enregistrement de l'écran : Autorisé » ; le guide ne signale pas de signature ad hoc.
- [ ] « Ouvrir avec » depuis le Finder (1 puis N fichiers), dépôt sur l'icône du Dock app fermée.

## 2. Extension et synchronisation (M5, SYNC §8, ERRATA §G.2)

Recette avec tes comptes réels (l'agent n'a fait aucun appel réel). Procédure détaillée :
`docs/extension.md`.

**A. Couper GatherOS (une fois)**

- [ ] Dans GatherOS : Réglages › Syncing → désactiver X, Instagram et Cosmos ; quitter GatherOS.
- [ ] Firefox : about:addons → retirer l'extension GatherOS. Chrome / Brave : `chrome://extensions` →
      la retirer. (Ne pas toucher aux fichiers `co.gatheros.host.json` : RecoltOS les ignore.)

**B. Installer RecoltOS et l'extension**

- [ ] `RECOLTOS_SIGN_IDENTITY="RecoltOS Local" pnpm run pack` puis `pnpm run app:install`, lancer
      `/Applications/RecoltOS.app` une fois (il écrit le manifest natif Firefox `com.recoltos.host.json` et les manifests Chromium).
- [ ] Firefox, version signée : `export WEB_EXT_API_KEY=… WEB_EXT_API_SECRET=…` (tes identifiants AMO),
      `pnpm run build:ext && pnpm run sign:firefox`, `pnpm run pack && pnpm run app:install`, puis
      glisser `dist-extension/signed/*.xpi` dans Firefox. **Ou** chargement temporaire :
      `about:debugging#/runtime/this-firefox` › « Charger un module complémentaire temporaire… » ›
      `~/Library/Application Support/RecoltOS/extension/firefox/manifest.json`.
- [ ] Firefox : about:addons › RecoltOS › Permissions : accès à x.com, instagram.com, cosmos.so autorisés.
- [ ] Bouton de l'extension : « ● Connecté à RecoltOS ». Réglages › Synchronisation : « Connectée — Firefox ».
- [ ] (Optionnel) Chrome / Brave : `chrome://extensions` › Mode développeur › Charger l'extension non
      empaquetée › `~/Library/Application Support/RecoltOS/extension/chromium/`.

**C. Première synchro, onglets fermés**

- [ ] Être connecté à X (et/ou Instagram, Cosmos) dans Firefox, puis FERMER tous les onglets de ces sites.
- [ ] Réglages › Synchronisation › activer X : feuille de risques, option « onglet en arrière-plan »
      décochée › Activer. La ligne passe à « Récupération de l'historique… » puis « Dernière synchro
      … · N nouveaux » ; aucun onglet ne s'ouvre ; le journal (« … » › Voir le journal) indique
      « arrière-plan ».
- [ ] Les favoris X apparaissent dans la Bibliothèque sans doublon des 208 posts importés ; les plus
      anciens récupérés sont signalés (« N publications plus anciennes récupérées · Revoir »).
- [ ] Ajouter un favori sur x.com (onglet ouvert) : il apparaît en moins de 30 s ; un favori ajouté
      depuis le téléphone apparaît en moins de 15 min, onglets x.com fermés, navigateur ouvert.
- [ ] Instagram : activer (avertissement GatherOS si encore détecté › « C'est fait »). Un carrousel de
      10 éléments donne un élément avec le badge 1/10. Aucun « checkpoint » Instagram.
- [ ] Cosmos : activer (être connecté sur cosmos.so dans Firefox suffit : l'extension obtient le
      jeton par `www.cosmos.so/api/refresh-token`, sans visite). Si « Connecte-toi à Cosmos » persiste
      alors que tu es connecté : noter le message du journal dans `docs/contrats/CHANGELOG.md`.
- [ ] X : si la ligne indique « X refuse la requête de l'extension », ouvrir x.com/i/bookmarks une
      fois (les favoris affichés sont récupérés par capture passive) et noter le message du journal
      (signature `x-client-transaction-id` probablement exigée, ERRATA §G.3).
- [ ] Navigateur quitté : la ligne affiche « Navigateur fermé : la synchro reprendra à son ouverture ».
- [ ] Si un site refuse la lecture (« … refuse la requête de l'extension ») : noter la source et le
      message dans `docs/contrats/CHANGELOG.md` ; essayer le repli « Ouvrir un onglet en arrière-plan si
      besoin » de cette source.

**D. Enregistrement manuel et robustesse**

- [ ] Clic droit sur une image (Firefox) › Enregistrer dans RecoltOS : élément créé en moins de 2 s, toast.
- [ ] App fermée : clic droit sur une image › « RecoltOS est fermé : ajouté au prochain lancement » ;
      l'élément apparaît au lancement suivant.
- [ ] Suppression définitive d'un élément synchronisé : non réimporté par la synchro (y compris
      « Tout resynchroniser »).
- [ ] Désinstallation : `RecoltOS --uninstall-native-hosts` retire `com.recoltos.host.json`, laisse
      `co.gatheros.host.json` intact (`find ~/Library/Application\ Support -maxdepth 4 -name '*.host.json'`).
- [ ] Aucun `ct0`, `sessionid`, `Bearer` dans les journaux ni dans la base :
      `grep -rIl -E 'ct0=|sessionid=|Bearer [A-Za-z0-9]' ~/Library/Application\ Support/RecoltOS` vide.

## 3. Interface (M3 à M7)

- [ ] Quick Look (Espace) sur un élément de la bibliothèque.
- [ ] Glisser une carte vers Finder, vers une collection ; glisser un fichier du Finder dans la fenêtre = import.
- [ ] Régions de glisser : le menu du sélecteur de bibliothèque, le voile de la palette et les boutons du Viewer restent cliquables.
- [ ] Thème clair, sombre et système : bascule en direct, aucune image blanche au démarrage.
- [ ] Aucune bannière « plan / Upgrade », aucun texte anglais visible, aucune image floue en Retina.
- [ ] ⌘W pendant l'édition d'un Space de 500 nœuds : rien n'est perdu à la réouverture.

## 4. Clavier AZERTY

- [ ] ⌘1 / ⌘2 / ⌘3 (Bibliothèque / Collections / Spaces).
- [ ] ⌘Z dans un champ de texte et hors champ ; ⌘A ; ⌘+ / ⌘= / ⌘− (zoom).

## 5. Installation

- [ ] `pnpm run app:install` copie dans `/Applications`, l'app se lance sans alerte Gatekeeper.
- [ ] `codesign -dr -` identique entre deux builds successifs.
- [ ] Données uniquement sous `~/Library/Application Support/RecoltOS` ; rien écrit dans le dossier GatherOS.
- [ ] Démarrage < 2 s (médiane de 5), défilement fluide sur 408 éléments (`pnpm run test:perf`).

## Résultat

- [ ] Tous les points ci-dessus sont cochés, ou l'écart est consigné dans `docs/contrats/CHANGELOG.md`.

Signature : ____________________ Date : `____-__-__`
