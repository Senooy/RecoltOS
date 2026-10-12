# Checklist manuelle signée

Ce que les tests automatiques ne peuvent pas prouver : permissions TCC, comptes réels, vrai navigateur,
matériel, IA facturée sur ton abonnement. À dérouler **dans l'ordre** sur le **build packagé signé**
« RecoltOS Local », avant le tag `v0.1.0` (PLAN §8, QA §6.7).

Règles : une case n'est cochée que si le comportement a été **vu**, jamais déduit. Une case cochée
avant ce passage porte la mention « (rapporté par l'utilisateur, date) ». Un écart se note dans
`docs/contrats/CHANGELOG.md` avec la source et le message affiché.

Ce que l'agent a déjà prouvé automatiquement (pas à refaire) : `pnpm run verify` (dont le parcours
complet `tests/e2e/security.spec.ts` sur une copie de ta bibliothèque : 0 requête externe, 0 violation
CSP, aucun `ct0` / `sessionid` / `Bearer` sur disque, manifests GatherOS intacts), `pnpm run dist`
(fuses fermés vérifiés par `check:dist`), `pnpm run test:packaged` (grille rendue par l'app livrée,
aller-retour de l'hôte natif packagé).

- **Passage** : date `____-__-__` · build (`git rev-parse --short HEAD`) `________` · initiales `____`
- **Préconditions** : GatherOS quitté, sa sync et son extension désactivées (§3.A) ;
  `RECOLTOS_USER_DATA` non défini ; certificat « RecoltOS Local » présent
  (`security find-identity -v -p codesigning`, procédure : `docs/signature.md`).

## 1. Installation dans /Applications

```sh
RECOLTOS_SIGN_IDENTITY="RecoltOS Local" pnpm run dist   # verify:fast + pack + check:dist
pnpm run app:install                                    # copie dans /Applications et lance
```

- [ ] `pnpm run app:install` copie dans `/Applications` ; l'app se lance depuis le Dock sans alerte Gatekeeper.
- [ ] `codesign -dvv /Applications/RecoltOS.app 2>&1 | grep Authority` affiche `Authority=RecoltOS Local`.
- [ ] `codesign -dr - /Applications/RecoltOS.app` identique entre deux builds successifs (refaire `dist` + `app:install`, comparer).
- [ ] Bibliothèque importée présente (412 éléments) ; données uniquement sous `~/Library/Application Support/RecoltOS` ; rien écrit dans le dossier GatherOS.
- [ ] Démarrage perçu < 2 s ; défilement fluide de la grille (mesures automatiques : `docs/perf.md`).

## 2. Capture d'écran (M3, SPACES §8.2)

Permission : ⌘⇧S → invite « Enregistrement de l'écran » (ou guide RecoltOS) → Réglages Système ›
Confidentialité et sécurité › Enregistrement de l'écran et de l'audio système → activer **RecoltOS** →
« Relancer RecoltOS ». Pour recommencer à zéro : `tccutil reset ScreenCapture com.recoltos.app`.

- [x] Permission Enregistrement de l'écran accordée à RecoltOS (rapporté par l'utilisateur, 2026-10-12).
- [ ] Réglages › Capture : « Enregistrement de l'écran : Autorisé » ; le guide ne signale pas de signature ad hoc.
- [ ] ⌘⇧S global déclenche la capture, app au premier plan **et** en arrière-plan.
- [ ] Mode région : sélection à la souris, Échap annule, l'élément apparaît dans la bibliothèque.
- [ ] Dossier de dépôt : choisir le Bureau déclenche l'invite d'accès ; le PNG « Capture RecoltOS … » y est écrit.
- [ ] **Permission stable sur deux builds** : après un second `dist` + `app:install` (même identité), l'invite « Enregistrement de l'écran » ne revient pas et ⌘⇧S capture directement.
- [ ] Raccourci modifié à chaud ; avec GatherOS ouvert, le message de conflit est en français.
- [ ] Toutes fenêtres fermées (⌘W) : ⌘⇧S capture toujours ; la notification « Capture ajoutée » rouvre l'élément dans une fenêtre recréée.
- [ ] ⌃ pendant la sélection : l'image est prise depuis le presse-papiers.
- [ ] Capture d'une image déjà présente : « Déjà dans la bibliothèque ».
- [ ] « Ouvrir avec » depuis le Finder (1 puis N fichiers) ; dépôt sur l'icône du Dock, app fermée.

## 3. Extension et synchronisation (M5, SYNC §8, ERRATA §G.2 / §G.3)

Procédure détaillée : `docs/extension.md`. L'agent n'a fait **aucun** appel réel à X, Instagram ou Cosmos.

**A. Couper GatherOS (une fois)**

- [ ] GatherOS › Réglages › Syncing : X, Instagram et Cosmos désactivés ; GatherOS quitté.
- [ ] Extension GatherOS retirée de Firefox (about:addons) et de Chrome / Brave (`chrome://extensions`).
      Ne pas toucher aux fichiers `co.gatheros.host.json` : RecoltOS les ignore.

**B. Extension Firefox**

- [ ] `/Applications/RecoltOS.app` lancé une fois : `~/Library/Application Support/Mozilla/NativeMessagingHosts/com.recoltos.host.json` existe.
- [x] **Chargement temporaire** : `about:debugging#/runtime/this-firefox` › « Charger un module complémentaire temporaire… » › `~/Library/Application Support/RecoltOS/extension/firefox/manifest.json` (rapporté par l'utilisateur, 2026-10-12).
- [ ] **Version signée** (installation permanente) : `export WEB_EXT_API_KEY=… WEB_EXT_API_SECRET=…` (tes identifiants AMO, jamais dans un fichier du dépôt), `pnpm run build:ext && pnpm run sign:firefox`, puis `pnpm run dist && pnpm run app:install` ; glisser `dist-extension/signed/*.xpi` dans Firefox. L'extension survit au redémarrage de Firefox.
- [ ] about:addons › RecoltOS › Permissions : x.com, instagram.com, cosmos.so (et CDN) autorisés.
- [ ] Bouton de l'extension : « ● Connecté à RecoltOS » ; Réglages › Synchronisation : « Connectée — Firefox ».

**C. Synchronisation réelle, onglets fermés**

Être connecté au site dans Firefox, puis **fermer tous les onglets** de ce site avant « Synchroniser maintenant ».

- [x] X : favoris synchronisés dans Firefox, extension temporaire (rapporté par l'utilisateur, 2026-10-12).
- [x] Instagram : enregistrements synchronisés dans Firefox, extension temporaire (rapporté par l'utilisateur, 2026-10-12).
- [x] Cosmos : éléments synchronisés dans Firefox, extension temporaire, sans visite de cosmos.so (rapporté par l'utilisateur, 2026-10-12).
- [ ] Onglets de x.com / instagram.com / cosmos.so **tous fermés** pendant la synchro : aucun onglet ne s'ouvre ; le journal (« … » › Voir le journal) indique « arrière-plan ».
- [ ] Pas de doublon des 208 posts X importés ; les plus anciens récupérés sont signalés (« N publications plus anciennes récupérées · Revoir »).
- [ ] Un favori ajouté sur x.com apparaît en moins de 30 s ; un favori ajouté depuis le téléphone apparaît en moins de 15 min, onglets fermés, navigateur ouvert.
- [ ] Instagram : un carrousel de 10 éléments donne un élément avec le badge 1/10 ; aucun « checkpoint ».
- [ ] Si X répond « X refuse la requête de l'extension » : ouvrir x.com/i/bookmarks une fois (capture passive) et noter le message du journal (signature `x-client-transaction-id`, ERRATA §G.3).
- [ ] Navigateur quitté : la ligne affiche « Navigateur fermé : la synchro reprendra à son ouverture ».

**D. Chrome (optionnel) et robustesse**

- [ ] Chrome / Brave : `chrome://extensions` › Mode développeur › « Charger l'extension non empaquetée » › `~/Library/Application Support/RecoltOS/extension/chromium/` ; bouton « ● Connecté à RecoltOS ».
- [ ] Clic droit sur une image › « Enregistrer dans RecoltOS » : élément créé en moins de 2 s, toast.
- [ ] App fermée : clic droit sur une image › « RecoltOS est fermé : ajouté au prochain lancement » ; l'élément apparaît au lancement suivant.
- [ ] Suppression définitive d'un élément synchronisé : non réimporté (y compris « Tout resynchroniser »).
- [ ] Aucun secret sur disque après une vraie synchro :
      `grep -rIl -E 'ct0=|sessionid=|Bearer [A-Za-z0-9]' ~/Library/Application\ Support/RecoltOS` ne renvoie rien.
- [ ] Désinstallation des hôtes : `/Applications/RecoltOS.app/Contents/MacOS/RecoltOS --uninstall-native-hosts` retire `com.recoltos.host.json` et laisse `co.gatheros.host.json` intact
      (`find ~/Library/Application\ Support -maxdepth 4 -name '*.host.json'`).

## 4. Interface (M3 à M7)

- [ ] Quick Look (Espace, ou Présentation › Aperçu rapide) sur une image, une vidéo et un post.
- [ ] Glisser une **vraie** sélection de fichiers depuis le Finder dans la fenêtre = import (rapport « N ajoutés · M doublons »).
- [ ] Glisser une carte vers le Finder (le fichier original est copié) et vers une collection.
- [ ] Régions de glisser : le menu du sélecteur de bibliothèque, le voile de la palette et les boutons du Viewer restent cliquables.
- [ ] Thème clair, sombre et système : bascule en direct, aucune image blanche au démarrage ; feux tricolores bien placés en sombre.
- [ ] Aucune bannière « plan / Upgrade », aucun texte anglais visible, aucune image floue en Retina (avatars des posts légèrement doux : connu, ERRATA §H).
- [ ] ⌘W pendant l'édition d'un Space de 500 nœuds : rien n'est perdu à la réouverture.

## 5. Clavier AZERTY

- [ ] ⌘1 / ⌘2 / ⌘3 (Bibliothèque / Collections / Spaces).
- [ ] ⌘K (palette), ⌘F (recherche), ⌘, (Réglages).
- [ ] ⌘Z dans un champ de texte et hors champ ; ⌘A ; ⌘+ / ⌘= / ⌘− (zoom).
- [ ] Raccourci de capture sur une lettre : le libellé affiché correspond à la touche réellement pressée.

## 6. IA réelle (abonnements `claude` / `codex`, consomme ton quota)

- [x] Détection de `claude` corrigée (CLI installé via `.zshrc`, commit `c5ba5a8`) (rapporté par l'utilisateur, 2026-10-12).
- [ ] Réglages › IA : moteur Claude « Connecté » ; test de connexion réel réussi ; Codex détecté si installé.
- [ ] Consentement demandé avant le premier appel ; aucun appel tant que le moteur est « Désactivé ».
- [ ] 5 éléments analysés avec Claude (image, vidéo, post, carrousel, capture) : nom, description FR, tags, texte détecté cohérents.
- [ ] Idem avec Codex en secours (si installé).
- [ ] Aperçu de l'envoi (Réglages › IA › Confidentialité) : fichiers et prompt exacts ; journal des appels à jour.
- [ ] Budget : la file s'arrête à la limite horaire (120/h) et reprend ; « Arrêter » vide la file.

## Résultat

- [ ] Tous les points ci-dessus sont cochés, ou l'écart est consigné dans `docs/contrats/CHANGELOG.md`.

Signature : ____________________ Date : `____-__-__`
