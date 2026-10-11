# Extension navigateur RecoltOS (M5)

Une seule base de code (`extension/`), deux builds :

| Cible                        | Dossier                    | Particularités                                                                         |
| ---------------------------- | -------------------------- | -------------------------------------------------------------------------------------- |
| Firefox (prioritaire)        | `dist-extension/firefox/`  | MV3, `background.scripts`, identifiant `recoltos@local`, Firefox 142 au minimum        |
| Chrome, Brave, Edge, Vivaldi | `dist-extension/chromium/` | MV3, service worker, champ `key` → identifiant fixe `kkcpbglfgmkcjndibkbpjdiakanmbdhi` |

L'extension parle à l'app par **native messaging** : le navigateur lance l'hôte
`RecoltOS.app/Contents/Resources/native-host/recolt-host` (exécutable séparé), qui relaie vers le socket
local de l'app. Aucun port réseau n'est ouvert. App fermée : les enregistrements (≤ 8 Mio) sont mis en
attente et ajoutés au lancement suivant.

## Construire et vérifier

```sh
pnpm run build:ext      # → dist-extension/chromium/ et dist-extension/firefox/
pnpm run lint:ext       # web-ext lint sur la version Firefox (0 erreur, 0 avertissement)
pnpm run pack           # app packagée : embarque l'hôte et les deux extensions (+ le .xpi signé s'il existe)
```

Au lancement, l'app packagée copie les extensions dans un chemin fixe :
`~/Library/Application Support/RecoltOS/extension/{firefox,chromium}/`, et écrit les manifests natifs
(`com.recoltos.host.json`) pour chaque navigateur présent, dont
`~/Library/Application Support/Mozilla/NativeMessagingHosts/` pour Firefox (`allowed_extensions`).
En développement, rien n'est écrit sauf avec `RECOLTOS_INSTALL_DEV_HOST=1` (nom `com.recoltos.host.dev`).

## Firefox : version signée (installation permanente)

Firefox release refuse les extensions non signées en installation permanente. La signature « non
répertoriée » (`unlisted`) passe par addons.mozilla.org sans publier l'extension.

1. Sur <https://addons.mozilla.org/developers/addon/api/key/>, connecte-toi et génère des
   « identifiants d'API » (émetteur JWT et secret JWT).
2. Dans ton terminal (les clés restent chez toi, ne les écris dans aucun fichier du dépôt) :
   ```sh
   export WEB_EXT_API_KEY='user:…'      # émetteur JWT
   export WEB_EXT_API_SECRET='…'        # secret JWT
   pnpm run build:ext && pnpm run sign:firefox
   ```
   Le fichier signé arrive dans `dist-extension/signed/*.xpi`. Chaque nouvelle signature exige une
   version nouvelle : augmente `EXTENSION_VERSION` dans `src/shared/bridge/constants.ts`.
3. `pnpm run pack` l'embarque ; dans l'app, Réglages › Synchronisation › Installer l'extension… ›
   Firefox › « Révéler le fichier signé ».
4. Glisse le `.xpi` dans une fenêtre Firefox (ou about:addons › ⚙️ › « Installer un module depuis un
   fichier… ») et confirme.

## Firefox : chargement temporaire (tests)

1. Ouvre `about:debugging#/runtime/this-firefox`.
2. « Charger un module complémentaire temporaire… ».
3. Choisis `manifest.json` dans `~/Library/Application Support/RecoltOS/extension/firefox/` (ou
   `dist-extension/firefox/`).

L'extension disparaît au redémarrage de Firefox.

**Autorisations (Firefox MV3)** : les accès aux sites sont des autorisations que Firefox peut laisser
désactivées. Vérifie about:addons › RecoltOS › Permissions : x.com, instagram.com, cosmos.so (et leurs
CDN) doivent être autorisés. Sinon, le bouton de l'extension affiche « Autoriser l'accès aux sites » et
Réglages › Synchronisation l'indique pour chaque source.

## Chrome, Brave, Edge, Vivaldi

1. Ouvre `chrome://extensions` (Brave : `brave://extensions`, Edge : `edge://extensions`).
2. Active le **Mode développeur**.
3. « Charger l'extension non empaquetée » → `~/Library/Application Support/RecoltOS/extension/chromium/`.

## Comment fonctionne la synchronisation

- Elle tourne dans le **script d'arrière-plan** de l'extension, **sans ouvrir d'onglet**, dès qu'une
  session est ouverte (cookies présents) sur X, Instagram ou Cosmos dans ce navigateur.
- C'est l'app qui planifie (X toutes les 15 min, Instagram et Cosmos toutes les 30 min) et qui décide
  page par page (arrêt au premier élément déjà connu en incrémental). L'extension rejoue les requêtes
  du site avec tes cookies (jeton CSRF lu par l'API `cookies` : `ct0` pour X, `csrftoken` pour
  Instagram) ; les en-têtes `Origin` / `Referer` sont réécrits vers le site par des règles
  `declarativeNetRequest`. Les cookies ne quittent jamais le navigateur.
- **La synchro ne tourne que lorsque le navigateur est ouvert.** Navigateur fermé : « Navigateur fermé :
  la synchro reprendra à son ouverture ».
- Les médias sont téléchargés **par l'app** (sans cookie).
- « Ouvrir un onglet en arrière-plan si besoin » (menu « … » de chaque source) est un repli,
  **désactivé par défaut**, utilisé seulement si le site refuse la requête d'arrière-plan.

## Tests

```sh
pnpm exec vitest run tests/unit/extension tests/unit/bridge tests/unit/sync   # unitaires
pnpm run test:ext            # Chromium de test, profil jetable, faux serveur, app de test
pnpm run test:ext:firefox    # Firefox 157 réel, profil jetable : chargement de l'extension
pnpm run test:packaged       # app packagée : hôte natif, manifests de test, désinstallation
```

Aucun de ces tests n'utilise tes navigateurs, tes profils, tes cookies ni tes comptes.

## Désinstaller le connecteur

`/Applications/RecoltOS.app/Contents/MacOS/RecoltOS --uninstall-native-hosts` : retire uniquement les fichiers `com.recoltos.host*.json`. Les manifests `co.legacy.host.json` ne
sont jamais touchés.
