# RecoltOS

Bibliothèque visuelle locale pour macOS (Electron) : images, vidéos, posts X / Instagram / Cosmos,
pages web et captures d'écran rangés dans une grille, des collections et des Spaces (toiles libres).
Reconstruction clean-room de GatherOS, à usage personnel : pas de compte, pas de licence, pas de mise
à jour automatique, pas de télémétrie. Interface en français.

- **Bibliothèque** : grille masonry, onglets (Tout, Enregistrés, Non classés, Corbeille, Masqués),
  tri, filtres, couleurs, vue détail (image, vidéo, post, carrousel), Redécouvrir, palette ⌘K.
- **Collections** et sous-collections, étagère 3D ; **Spaces** : notes, formes, texte, éléments de la
  bibliothèque, export PNG.
- **Ajout** : glisser-déposer, coller (⌘V), capture d'écran ⌘⇧S, extension navigateur,
  import de la bibliothèque GatherOS.
- **Synchronisation** des favoris X, enregistrements Instagram et éléments Cosmos par l'extension, en
  arrière-plan, sans onglet ouvert.
- **IA** (facultative) : nom, description, tags et texte détecté par les CLI `claude` ou `codex` de
  tes abonnements ; recherche plein texte locale (SQLite FTS5).

## Prérequis

- macOS sur Apple Silicon (le build est `arm64`).
- Node `22.22.2+` ou `24.15.0+`, et pnpm 12.6.0 via corepack (`corepack enable`). Le pnpm 9.15.0 de
  Homebrew n'est pas utilisé.
- `ffmpeg` et `ffprobe` de Homebrew (`brew install ffmpeg`) : vignettes et aperçus des vidéos.
- Pour garder les permissions macOS entre deux builds : le certificat local **« RecoltOS Local »**
  (voir plus bas). Sans lui, le build est signé « ad hoc » et fonctionne, mais macOS redemande
  l'autorisation Enregistrement de l'écran après chaque reconstruction.

`pnpm run check:env` vérifie l'environnement (Node, pnpm, ffmpeg, certificat).

## Installation

```sh
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
pnpm install
RECOLTOS_SIGN_IDENTITY="RecoltOS Local" pnpm run pack   # → dist/mac-arm64/RecoltOS.app, signé
pnpm run app:install                                     # copie dans /Applications et lance l'app
```

- `pnpm run dist` fait la même chose que `pack` après les contrôles rapides (`verify:fast`) et vérifie
  le paquet (`check:dist` : fuses fermés, hôte natif signé, extensions embarquées).
- `app:install` vérifie la signature de la copie avant de remplacer l'app installée ; il ne touche
  jamais à tes données. Variables : `RECOLTOS_INSTALL_DIR` (défaut `/Applications`),
  `RECOLTOS_NO_OPEN=1`.
- Sans `RECOLTOS_SIGN_IDENTITY`, la signature est ad hoc (`-`).

### Certificat « RecoltOS Local »

À créer une fois dans **Trousseau d'accès › Assistant de certification › Créer un certificat…** :
nom `RecoltOS Local`, type d'identité « Auto-signé racine », type « Signature de code », puis
« Se fier › Signature de code : Toujours approuver ». Vérification :
`security find-identity -v -p codesigning` doit lister `"RecoltOS Local"`.
Procédure détaillée et raisons : [`docs/signature.md`](docs/signature.md).

### Première utilisation

1. **Capture d'écran** : ⌘⇧S, puis autorise RecoltOS dans Réglages Système › Confidentialité et
   sécurité › Enregistrement de l'écran et de l'audio système, et relance l'app.
2. **Import GatherOS** : quitte GatherOS, puis dans RecoltOS : Réglages › Bibliothèques ›
   « Importer depuis GatherOS » (ou Fichier › Importer depuis GatherOS…). L'import lit une **copie**
   de la base GatherOS : le dossier GatherOS n'est jamais modifié, et un second import ne recrée rien.
3. **Extension** et **synchronisation** : voir ci-dessous.

## Extension navigateur et synchronisation

Une base de code (`extension/`), deux builds : Firefox (prioritaire) et Chromium (Chrome, Brave,
Edge, Vivaldi). L'extension parle à l'app par native messaging (aucun port réseau). L'app installée
recopie les extensions dans `~/Library/Application Support/RecoltOS/extension/{firefox,chromium}/` et
écrit les manifests `com.recoltos.host.json` des navigateurs présents.

**Firefox, chargement temporaire** (disparaît au redémarrage de Firefox) :
`about:debugging#/runtime/this-firefox` › « Charger un module complémentaire temporaire… » ›
`~/Library/Application Support/RecoltOS/extension/firefox/manifest.json`.

**Firefox, version signée** (installation permanente ; Firefox release refuse les extensions non
signées). Avec tes identifiants d'API addons.mozilla.org (jamais écrits dans un fichier du dépôt) :

```sh
export WEB_EXT_API_KEY='user:…'   # émetteur JWT
export WEB_EXT_API_SECRET='…'     # secret JWT
pnpm run build:ext && pnpm run sign:firefox      # → dist-extension/signed/*.xpi (non répertoriée)
RECOLTOS_SIGN_IDENTITY="RecoltOS Local" pnpm run pack && pnpm run app:install
```

puis glisse le `.xpi` dans une fenêtre Firefox. Chaque nouvelle signature exige une nouvelle version
(`EXTENSION_VERSION`, `src/shared/bridge/constants.ts`).

**Chrome / Brave** : `chrome://extensions` › Mode développeur › « Charger l'extension non empaquetée » ›
`~/Library/Application Support/RecoltOS/extension/chromium/`.

**Synchronisation** : désactive d'abord la synchro et l'extension de GatherOS, reste connecté à X,
Instagram ou Cosmos dans le navigateur, puis Réglages › Synchronisation › active la source. La synchro
tourne en arrière-plan tant que le navigateur est ouvert, sans ouvrir d'onglet. Détails, autorisations
Firefox et dépannage : [`docs/extension.md`](docs/extension.md).

## IA par abonnement (`claude` / `codex`)

RecoltOS n'utilise **aucune clé d'API** : il appelle les CLI officiels installés et connectés à ton
abonnement (`claude` de Claude Code, `codex` d'OpenAI). Réglages › IA › « Changer » : choisis le moteur,
lis et accepte le consentement ; rien n'est envoyé avant. Budget par défaut 120 appels par heure,
Codex en secours facultatif ; aperçu exact de chaque envoi et journal dans Réglages › IA. Les CLI sont
cherchés dans le PATH de ton shell interactif (`.zshrc`) et dans les dossiers d'installation courants.

## Données

- Tout est sous `~/Library/Application Support/RecoltOS/` : `prefs.json`, `libraries.json`,
  `libraries/<id>/recolt.db` (SQLite), médias et dérivés, `spaces/`, `logs/`, `extension/`.
- Réglages › Données : export zip de la bibliothèque, instantanés et restauration.
- Rien n'est envoyé ailleurs : le renderer n'a aucun accès réseau (CSP sans `https:`) ; l'app ne
  télécharge que les médias et avatars des posts synchronisés (Réglages › Stockage, interrupteur
  « Télécharger les médias distants »).

### Désinstallation

```sh
/Applications/RecoltOS.app/Contents/MacOS/RecoltOS --uninstall-native-hosts   # retire com.recoltos.host.json
rm -rf /Applications/RecoltOS.app
rm -rf ~/Library/Application\ Support/RecoltOS          # efface TOUTES tes données RecoltOS
tccutil reset ScreenCapture com.recoltos.app             # facultatif : oublie la permission
```

Les manifests `co.gatheros.host.json` et le dossier GatherOS ne sont jamais touchés. Retire aussi
l'extension de tes navigateurs.

## Limites connues

- **X** : x.com peut exiger l'en-tête signé `x-client-transaction-id`, non reproduit. Si la ligne X
  indique « X refuse la requête de l'extension », ouvre une fois x.com/i/bookmarks : les favoris
  affichés sont récupérés par la page (ERRATA §G.3).
- La synchro ne tourne que **navigateur ouvert** ; Safari n'est pas pris en charge.
- Instagram : budget strict (20 appels par synchro, 200 par jour) pour éviter les « checkpoints ».
- `ffmpeg` Homebrew est requis : l'app n'est pas portable telle quelle sur un Mac sans Homebrew.
- Thème sombre **extrapolé** hors surfaces immersives (pas de référence GatherOS sombre).
- Mémoire : la toile Spaces de 500 nœuds reste vers 0,5–0,7 Go d'empreinte ; l'objectif « < 600 Mo
  résident » n'est pas tenu de façon fiable ([`docs/perf.md`](docs/perf.md)).
- Recherche visuelle (embeddings) hors V1 ; pas de mise à jour automatique ; Apple Silicon seulement.
- Le certificat auto-signé suffit à garder la permission Enregistrement de l'écran sur cette machine ;
  il n'est pas reconnu ailleurs (pas de notarisation).

## Développement

```sh
pnpm run dev                                  # electron-vite (Vite + main + preload)
pnpm run dev:demo                             # avec une bibliothèque de démonstration isolée
RECOLTOS_USER_DATA="$PWD/.tmp/userdata" pnpm run dev   # données isolées
```

Toujours `pnpm run <script>` (jamais `pnpm doctor` / `pnpm rebuild`, commandes intégrées de pnpm).

| Script                          | Rôle                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `verify:fast`                   | format, lint, typecheck, `check:pkg`, tests unitaires (< 45 s)                      |
| `verify`                        | `verify:fast` + e2e + visuel + garde clean-room (< 4 min)                           |
| `verify:full`                   | `verify` + `test:real` + `dist` + `test:packaged` + `test:perf`                     |
| `test:e2e` / `test:visual`      | Playwright sur l'app Electron (dont `tests/e2e/security.spec.ts`, parcours complet) |
| `test:packaged`                 | app packagée : grille rendue (fuses fermés), hôte natif                             |
| `test:perf`                     | grille et toile Spaces (`docs/perf.md`)                                             |
| `test:ext` / `test:ext:firefox` | extension dans le Chromium de Playwright / Firefox (opt-in)                         |
| `build:ext` / `sign:firefox`    | builds de l'extension / signature Firefox `unlisted`                                |
| `pack` / `dist` / `app:install` | paquet signé, paquet + contrôles, installation dans `/Applications`                 |
| `shots` / `shots:compare`       | boucle de fidélité visuelle contre les captures de référence (`docs/fidelite.md`)   |

Variables de test : `RECOLTOS_USER_DATA`, `RECOLTOS_E2E=1`, `RECOLTOS_WINDOW=1280x820`,
`RECOLTOS_HOME` (QA §2). Le parcours e2e complet utilise un clone APFS de `.tmp/m7-real`
(ou `RECOLTOS_E2E_REAL=<dossier>`), sinon une bibliothèque de démonstration.

## Documents

- [`docs/plan/PLAN.md`](docs/plan/PLAN.md) (fait foi), [`docs/plan/work_packages.json`](docs/plan/work_packages.json) (lots).
- [`docs/specs/ERRATA.md`](docs/specs/ERRATA.md) puis `docs/specs/*.md` : specs par domaine.
- [`docs/CONTRATS.md`](docs/CONTRATS.md), [`docs/contrats/CHANGELOG.md`](docs/contrats/CHANGELOG.md) : contrats partagés et journal.
- [`docs/checklist-manuelle.md`](docs/checklist-manuelle.md) : recette manuelle signée.
- [`docs/fidelite.md`](docs/fidelite.md), [`docs/perf.md`](docs/perf.md), [`docs/extension.md`](docs/extension.md), [`docs/signature.md`](docs/signature.md).

## Clean-room

Ne jamais ouvrir le paquet applicatif de GatherOS ni aucun code GatherOS ; ne jamais lire, copier ni
journaliser le jeton d'extension de GatherOS ; GatherOS reste en lecture seule
(`pnpm run guard`, dans `verify`).
