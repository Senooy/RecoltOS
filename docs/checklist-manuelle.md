# Checklist de test manuel

Ce que les tests automatiques ne peuvent pas prouver : permissions macOS, vrai navigateur, comptes
réels, matériel, IA facturée sur ton abonnement. À dérouler **dans l'ordre** sur un **build packagé
signé** (de préférence avec le certificat local « RecoltOS Local », voir `docs/signature.md`), avant
une version.

Règle : une case n'est cochée que si le comportement a été **vu**, jamais déduit. Note chaque écart
(étape, message affiché, journal) dans une issue.

Déjà couvert automatiquement (pas à refaire) : `pnpm run verify` (dont le parcours complet
`tests/e2e/security.spec.ts` : 0 requête externe, 0 violation CSP, aucun `ct0` / `sessionid` /
`Bearer` sur disque), `pnpm run dist` (fuses vérifiés par `check:dist`), `pnpm run test:packaged`
(grille rendue par l'app livrée, aller-retour de l'hôte natif packagé).

- **Passage** : date `____-__-__` · build (`git rev-parse --short HEAD`) `________`
- **Préconditions** : `RECOLTOS_USER_DATA` non défini ; certificat présent si tu signes
  (`security find-identity -v -p codesigning`).

## 1. Installation dans /Applications

```sh
RECOLTOS_SIGN_IDENTITY="RecoltOS Local" pnpm run dist   # verify:fast + pack + check:dist
pnpm run app:install                                    # copie dans /Applications et lance
```

- [ ] `pnpm run app:install` copie dans `/Applications` ; l'app se lance depuis le Dock.
- [ ] `codesign -dvv /Applications/RecoltOS.app 2>&1 | grep Authority` affiche l'identité attendue.
- [ ] `codesign -dr - /Applications/RecoltOS.app` identique entre deux builds successifs (refaire `dist` + `app:install`, comparer).
- [ ] Données uniquement sous `~/Library/Application Support/RecoltOS`.
- [ ] Démarrage perçu < 2 s ; défilement fluide de la grille (mesures automatiques : `docs/perf.md`).

## 2. Capture d'écran et ajouts

Permission : ⌘⇧S → invite « Enregistrement de l'écran » (ou guide RecoltOS) → Réglages Système ›
Confidentialité et sécurité › Enregistrement de l'écran et de l'audio système → activer **RecoltOS** →
« Relancer RecoltOS ». Pour recommencer à zéro : `tccutil reset ScreenCapture com.recoltos.app`.

- [ ] Réglages › Capture : « Enregistrement de l'écran : Autorisé ».
- [ ] ⌘⇧S global déclenche la capture, app au premier plan **et** en arrière-plan.
- [ ] Mode région : sélection à la souris, Échap annule, l'élément apparaît dans la bibliothèque.
- [ ] Dossier de dépôt : choisir le Bureau déclenche l'invite d'accès ; le PNG « Capture RecoltOS … » y est écrit.
- [ ] **Permission stable sur deux builds** (même identité) : l'invite ne revient pas et ⌘⇧S capture directement.
- [ ] Raccourci modifié à chaud ; un raccourci déjà pris affiche un message de conflit en français.
- [ ] Toutes fenêtres fermées (⌘W) : ⌘⇧S capture toujours ; la notification « Capture ajoutée » rouvre l'élément.
- [ ] ⌃ pendant la sélection : l'image est prise depuis le presse-papiers.
- [ ] Capture d'une image déjà présente : « Déjà dans la bibliothèque ».
- [ ] « Ouvrir avec » depuis le Finder (1 puis N fichiers) ; dépôt sur l'icône du Dock, app fermée.

## 3. Extension et synchronisation

Procédure détaillée : `docs/extension.md`. La synchronisation utilise des requêtes non officielles
avec ta session : teste-la sur un compte dont tu acceptes le risque (voir les avertissements du README).

**A. Extension Firefox**

- [ ] App lancée une fois : `~/Library/Application Support/Mozilla/NativeMessagingHosts/com.recoltos.host.json` existe.
- [ ] **Chargement temporaire** : `about:debugging#/runtime/this-firefox` › « Charger un module complémentaire temporaire… » › `~/Library/Application Support/RecoltOS/extension/firefox/manifest.json`.
- [ ] **Version signée** (facultatif) : `pnpm run build:ext && pnpm run sign:firefox` avec tes identifiants AMO, puis `pnpm run dist && pnpm run app:install` ; glisser `dist-extension/signed/*.xpi` dans Firefox. L'extension survit au redémarrage.
- [ ] about:addons › RecoltOS › Permissions : x.com, instagram.com, cosmos.so (et CDN) autorisés.
- [ ] Bouton de l'extension : « ● Connecté à RecoltOS » ; Réglages › Synchronisation : « Connectée — Firefox ».

**B. Synchronisation, onglets fermés**

Être connecté au site dans le navigateur, puis **fermer tous les onglets** de ce site avant
« Synchroniser maintenant ».

- [ ] X, Instagram, Cosmos : la première synchronisation ajoute les éléments ; aucun onglet ne s'ouvre ; le journal (« … » › Voir le journal) indique « arrière-plan ».
- [ ] Pas de doublon à la synchronisation suivante ; les éléments plus anciens récupérés sont signalés (« N publications plus anciennes récupérées · Revoir »).
- [ ] Un favori ajouté sur x.com apparaît en moins de 30 s ; un favori ajouté depuis un autre appareil apparaît en moins de 15 min, navigateur ouvert.
- [ ] Instagram : un carrousel de 10 éléments donne un élément avec le badge 1/10 ; aucun « checkpoint ».
- [ ] Si X répond « X refuse la requête de l'extension » : ouvrir x.com/i/bookmarks une fois et noter le message du journal.
- [ ] Navigateur quitté : la ligne affiche « Navigateur fermé : la synchro reprendra à son ouverture ».

**C. Chromium et robustesse**

- [ ] Chrome / Brave : « Charger l'extension non empaquetée » › `~/Library/Application Support/RecoltOS/extension/chromium/` ; bouton « ● Connecté à RecoltOS ».
- [ ] Clic droit sur une image › « Enregistrer dans RecoltOS » : élément créé en moins de 2 s, toast.
- [ ] App fermée : clic droit sur une image › « RecoltOS est fermé : ajouté au prochain lancement » ; l'élément apparaît au lancement suivant.
- [ ] Suppression définitive d'un élément synchronisé : non réimporté (y compris « Tout resynchroniser »).
- [ ] Aucun secret sur disque après une vraie synchro :
      `grep -rIl -E 'ct0=|sessionid=|Bearer [A-Za-z0-9]' ~/Library/Application\ Support/RecoltOS` ne renvoie rien.
- [ ] `/Applications/RecoltOS.app/Contents/MacOS/RecoltOS --uninstall-native-hosts` retire `com.recoltos.host.json` et rien d'autre
      (`find ~/Library/Application\ Support -maxdepth 4 -name '*.host.json'`).

## 4. Interface

- [ ] Quick Look (Espace) sur une image, une vidéo et un post.
- [ ] Glisser une sélection de fichiers depuis le Finder dans la fenêtre = import (rapport « N ajoutés · M doublons »).
- [ ] Glisser une carte vers le Finder (le fichier original est copié) et vers une collection.
- [ ] Régions de glisser : le menu du sélecteur de bibliothèque, le voile de la palette et les boutons de la vue détail restent cliquables.
- [ ] Thème clair, sombre et système : bascule en direct, aucun flash blanc au démarrage ; feux tricolores bien placés en sombre.
- [ ] Aucun texte anglais visible, aucune image floue en Retina.
- [ ] ⌘W pendant l'édition d'un Space de 500 nœuds : rien n'est perdu à la réouverture.

## 5. Clavier AZERTY

- [ ] ⌘1 / ⌘2 / ⌘3 (Bibliothèque / Collections / Spaces).
- [ ] ⌘K (palette), ⌘F (recherche), ⌘, (Réglages).
- [ ] ⌘Z dans un champ de texte et hors champ ; ⌘A ; ⌘+ / ⌘= / ⌘− (zoom).
- [ ] Raccourci de capture sur une lettre : le libellé affiché correspond à la touche réellement pressée.

## 6. IA réelle (CLI `claude` / `codex`, consomme ton quota)

- [ ] Réglages › IA : moteur Claude « Connecté » ; test de connexion réel réussi ; Codex détecté si installé.
- [ ] Consentement demandé avant le premier appel ; aucun appel tant que le moteur est « Désactivé ».
- [ ] 5 éléments analysés (image, vidéo, post, carrousel, capture) : nom, description en français, tags, texte détecté cohérents.
- [ ] Idem avec Codex en secours (si installé).
- [ ] Aperçu de l'envoi (Réglages › IA › Confidentialité) : fichiers et prompt exacts ; journal des appels à jour.
- [ ] Budget : la file s'arrête à la limite horaire (120/h) et reprend ; « Arrêter » vide la file.

## 7. Import depuis GatherOS (si une bibliothèque GatherOS est présente)

- [ ] Réglages › Bibliothèques › « Importer depuis GatherOS » : bibliothèque détectée, import terminé, résumé affiché ; le dossier source n'est pas modifié.
- [ ] Un second import ne recrée rien.
- [ ] Activer la synchronisation alors que l'ancienne app synchronise encore : l'avertissement de coexistence s'affiche.

## Résultat

- [ ] Tous les points ci-dessus sont cochés, ou chaque écart est consigné dans une issue.
