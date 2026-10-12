# Signature de RecoltOS et certificat « RecoltOS Local »

## Pourquoi signer avec une identité stable

macOS rattache les autorisations de confidentialité (Enregistrement d'écran, accès au Bureau, aux Documents…) à l'**exigence désignée** (_designated requirement_) du code de l'app, pas à son chemin. Avec une signature **ad hoc** (`-`), cette exigence est le `cdhash` : un hachage du contenu du bundle. Il reste identique tant que le bundle est identique octet pour octet, et change dès que le code, l'`Info.plist` ou les fuses changent. Après chaque nouveau build, macOS peut donc te redemander les permissions.

Avec un **certificat local stable**, l'exigence devient « identifiant `com.recoltos.app` + ce certificat » : elle ne dépend plus du contenu, et les permissions survivent aux reconstructions.

Aucune source officielle ne garantit qu'un certificat **auto-signé** produise un `granted` stable pour Enregistrement d'écran. Si la permission n'est pas conservée (ou si `CGPreflightScreenCaptureAccess` reste à `false` hors identité à Team ID), le repli est une identité **Apple Development** (voir plus bas). Les notifications d'Electron 42+ exigent en outre une app signée.

| Signature                     | `codesign -dr -`                                            | Permissions conservées entre deux builds |
| ----------------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| Ad hoc (`-`, par défaut)      | `designated => cdhash H"…"`                                 | Non, dès que le contenu change           |
| Certificat « RecoltOS Local » | `identifier "com.recoltos.app" and certificate leaf = H"…"` | Oui en pratique (non garanti par Apple)  |

Le build ad hoc reste pleinement fonctionnel : il suffit pour développer et pour lancer l'app. Le certificat n'est utile que pour garder les permissions entre les builds.

## Créer le certificat (action à faire par toi, une seule fois)

> **Nom attendu : « RecoltOS Local »** (exactement). C'est le nom passé dans `RECOLTOS_SIGN_IDENTITY` et cherché par `check:env`.

C'est un réglage de sécurité de ton Mac : aucun script ne le fait à ta place.

1. Ouvre **Trousseau d'accès** (Applications > Utilitaires).
2. Menu **Trousseau d'accès > Assistant de certification > Créer un certificat…**
3. Renseigne :
   - **Nom** : `RecoltOS Local` (exactement, avec la casse).
   - **Type d'identité** : _Auto-signé racine_.
   - **Type de certificat** : _Signature de code_.
   - Coche **Me laisser remplacer les réglages par défaut** pour pouvoir choisir une validité longue (par exemple 3650 jours), puis **Continuer** jusqu'au bout. Garde le trousseau **Session** (`login`).
4. Dans la liste, double-clique le certificat `RecoltOS Local`, déplie **Se fier**, et règle **Signature de code** sur **Toujours approuver**. Saisis ton mot de passe de session pour valider.
5. Vérifie qu'il est reconnu comme identité valide :

   ```sh
   security find-identity -v -p codesigning
   ```

   Tu dois voir une ligne `"RecoltOS Local"`. Sans l'étape 4, il n'apparaît pas. Dans ce cas la config (`electron-builder.config.cjs`) **échoue volontairement** avec « aucune identité de signature valide de ce nom dans le trousseau » : electron-builder seul, lui, logue « skipped macOS application code signing … Identity name is specified, but no valid identity », sort avec le code 0 et produit un build en signature ad hoc (cdhash instable), sans rien signaler d'autre.

À la première signature, macOS peut demander l'accès de `codesign` à la clé privée : choisis **Toujours autoriser**.

## Utiliser l'identité

```sh
RECOLTOS_SIGN_IDENTITY="RecoltOS Local" pnpm run dist
pnpm run app:install          # copie dans /Applications et ouvre l'app
```

- Variable absente ou vide : signature ad hoc `-` (`mac.identity` dans `electron-builder.config.cjs`).
- `identity: null` est volontairement évité : sur arm64 il ne laisse que la signature du linker, refusée au lancement.
- Si `RECOLTOS_SIGN_IDENTITY` est définie mais que l'identité est absente du trousseau, le build s'arrête avec une erreur claire (pas de repli silencieux sur l'ad hoc).
- `pnpm run app:install` (script `scripts/install-local.sh`) arrête l'app installée, remplace `/Applications/RecoltOS.app` via `ditto`, retire l'attribut de quarantaine, vérifie la signature (`codesign --verify --deep --strict`), vérifie que l'exigence désignée contient `certificate leaf` quand `RECOLTOS_SIGN_IDENTITY` est définie (sinon le build est en réalité ad hoc et le script échoue), puis ouvre l'app. Il ne touche **jamais** à `~/Library/Application Support/RecoltOS`.
- Variables du script : `RECOLTOS_INSTALL_DIR` (dossier cible, défaut `/Applications`) et `RECOLTOS_NO_OPEN=1` (n'ouvre pas l'app).

## Vérifier que la signature est stable

```sh
codesign -dr - dist/mac-arm64/RecoltOS.app      # note la ligne « designated => … »
RECOLTOS_SIGN_IDENTITY="RecoltOS Local" pnpm run dist
codesign -dr - dist/mac-arm64/RecoltOS.app      # doit être identique, même après un changement de code
codesign --verify --deep --strict --verbose=2 dist/mac-arm64/RecoltOS.app
```

Avec le bon certificat, la ligne ressemble à
`designated => identifier "com.recoltos.app" and certificate leaf = H"<empreinte du certificat>"`.

## Si les permissions se comportent mal

Après le **premier** passage d'une signature ad hoc à `RecoltOS Local` (ou inversement), l'exigence désignée change une dernière fois : macOS peut redemander les permissions, ou garder une ancienne entrée devenue inopérante. Remets-les à zéro, puis relance l'app et réaccorde-les :

```sh
tccutil reset ScreenCapture com.recoltos.app
tccutil reset SystemPolicyDesktopFolder com.recoltos.app
tccutil reset SystemPolicyDocumentsFolder com.recoltos.app
tccutil reset SystemPolicyDownloadsFolder com.recoltos.app
```

## Hors ligne

Avec une identité non ad hoc, `codesign` demande un horodatage au serveur d'Apple : sans réseau la signature peut échouer. Deux issues :

- tester l'option `mac.timestamp` d'electron-builder ;
- ou signer à la main : `codesign --force --deep --sign "RecoltOS Local" --timestamp=none dist/mac-arm64/RecoltOS.app`.

## Alternative : identité Apple Development

Si tu as un compte Apple Developer, une identité « Apple Development: … » se passe de la même façon (`RECOLTOS_SIGN_IDENTITY="Apple Development: Prénom Nom (XXXXXXXXXX)"`). Elle est stable aussi, mais expire (un an) et lie le build à ton compte. Le certificat local reste l'option par défaut.

## Distribution

RecoltOS n'est ni notarisé ni mis à jour automatiquement : chacun le construit et le signe localement. Une copie qui a voyagé (AirDrop, téléchargement) porte l'attribut de quarantaine :

```sh
xattr -dr com.apple.quarantine /Applications/RecoltOS.app
```

Depuis macOS 15, « clic droit > Ouvrir » ne suffit plus pour une app non notarisée : passe par Réglages Système > Confidentialité et sécurité > « Ouvrir quand même ».
