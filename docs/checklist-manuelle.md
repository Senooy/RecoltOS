# Checklist manuelle signée

Ce que les tests automatiques ne peuvent pas prouver (permissions TCC, comptes réels, matériel).
À dérouler sur le **build packagé signé** (`pnpm run dist` puis `pnpm run app:install`), avant chaque tag de
jalon concerné et avant `v0.1.0` (PLAN §8, QA §6.7). Chaque passage est daté et initialé par l'utilisateur :
une case n'est cochée que si le comportement a été vu, jamais déduit.

- **Passage** : date `____-__-__` · build `________` · signature `RecoltOS Local` / ad hoc · initiales `____`
- **Précondition** : GatherOS quitté, sa sync et son extension désactivées ; `RECOLTOS_USER_DATA` non défini.

## 1. Capture d'écran (M3, SPACES §8.2)

- [ ] ⌘⇧S global déclenche la capture, app au premier plan et en arrière-plan.
- [ ] Mode région : sélection à la souris, Échap annule, l'élément apparaît dans la bibliothèque.
- [ ] Dossier de dépôt : choisir le Bureau déclenche l'invite d'accès ; le fichier PNG y est écrit.
- [ ] L'invite « Enregistrement d'écran » n'apparaît **qu'une fois** ; elle ne revient pas après un second build signé avec la même identité.
- [ ] Raccourci modifié à chaud ; avec GatherOS ouvert, le message d'erreur de conflit est en français.
- [ ] Raccourci sur une lettre en AZERTY : le libellé affiché correspond à la touche réellement pressée.

## 2. Extension et synchronisation (M5, SYNC §8)

- [ ] Extension chargée dans **Chrome** puis dans **Brave** (dossier `dist-extension/`, identifiant stable).
- [ ] Clic droit sur une image → enregistrée en moins de 2 s ; app fermée : mise en file puis import au lancement.
- [ ] Favori X synchronisé en moins de 30 s ; carrousel Instagram 1/10 complet ; backfill sans doublon.
- [ ] Suppression définitive d'un élément : non ré-importé par la sync.
- [ ] Désinstallation propre : manifests natifs retirés, `co.gatheros.host.json` intact.
- [ ] Aucun `ct0`, `sessionid`, `Bearer` dans les journaux ni dans la base (`grep`).

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
