# Performances (WP-71)

Date : 2026-10-12. Machine : MacBook Pro Apple M5 Pro, 24 Go, écran Retina, macOS 27. Electron 44.4.5.
« Avant » = commit `0526b44` (correctifs de sync, avant M7) rebâti dans un worktree ; « après » = ce lot.
Chaque chiffre mémoire est la **médiane de 3 exécutions** (bruit d'une exécution à l'autre : ±40 Mo).

## Deux mesures de mémoire, à ne pas confondre

| Mesure                          | Source                                                                             | Ce qu'elle compte                                                                                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Résident** (`workingSetSize`) | `app.getAppMetrics()`, somme des processus                                         | Pages résidentes, **y compris le code partagé d'Electron compté une fois par processus** (≈ 100 Mo par processus). C'est la mesure du spike S1 de M6 (« 891 Mo »). Plancher d'une app Electron vide (une fenêtre, `data:` HTML, Retina) : **304–375 Mo**. |
| **Empreinte physique**          | `top -stats mem` (colonne « Mémoire » du Moniteur d'activité), somme des processus | Mémoire privée + compressée + **textures GPU (IOSurface/Metal)**, invisibles dans le résident. App Electron vide : 99 Mo.                                                                                                                                 |

Le résident ignore les textures du processus GPU, qui étaient le vrai poste : jusqu'à **1 000 Mo** d'empreinte GPU
sur la toile à 100 %. Les deux mesures sont relevées par `tests/perf/spaces.spec.ts`.

## Toile Spaces : 500 nœuds, Retina (spike S1 rejoué)

Protocole (comme S1 de M6) : clone APFS de `.tmp/m3-real` (412 éléments réels), fenêtre 1512 × 945 à DSF 2, space
de 500 nœuds `item` (480 images + 20 vidéos, grille 25 × 20). Étapes : bibliothèque (grille) avant d'ouvrir la
toile ; vue d'ensemble (⇧1, 500 nœuds visibles) ; 100 % (⌘0) après pan et zoom à la molette ; **exploration** de
12 arrêts à 150 % répartis sur la toile ; retour en vue d'ensemble.

| Étape                             | Résident avant | Résident après | Empreinte avant | Empreinte après | dont GPU avant → après | Variantes montées après             |
| --------------------------------- | -------------: | -------------: | --------------: | --------------: | ---------------------: | ----------------------------------- |
| Bibliothèque (408 cartes)         |            578 |            532 |             465 |             458 |              277 → 270 | —                                   |
| Vue d'ensemble                    |            594 |            619 |             497 |             433 |              237 → 177 | 500 vignettes                       |
| 100 % après pan/zoom              |            695 |            657 |       **1 406** |         **565** |            1 000 → 251 | 80 vignettes (avant : 80 × 1440w)   |
| Exploration à 150 %               |        **829** |        **516** |       **1 332** |         **678** |              918 → 406 | 12 vignettes                        |
| Retour en vue d'ensemble          |            679 |            500 |           1 032 |             562 |              614 → 279 | 500 vignettes (avant : 164 × 1440w) |
| Mesure finale du spike (M6 : 891) |            680 |        **498** |               — |               — |                      — | —                                   |

Fluidité (médiane des 3 exécutions ; « pic » = pire image des 3) :

| Geste                | Avant                             | Après                              |
| -------------------- | --------------------------------- | ---------------------------------- |
| Pan, vue d'ensemble  | 60 fps, p95 17,5 ms, pic 17,7 ms  | 60 fps, p95 17,5 ms, pic 17,7 ms   |
| Zoom, vue d'ensemble | 57,9 fps, p95 17,5 ms, pic 100 ms | 59,5 fps, p95 17,6 ms, pic 33,8 ms |
| Pan à 100 %          | 60 fps, p95 17,4 ms               | 60 fps, p95 17,6 ms                |
| Zoom à 100 %         | 60 fps, p95 17,5 ms, pic 34 ms    | 60 fps, p95 17,6 ms, pic 17,7 ms   |

Lecture : l'objectif « < 600 Mo pour l'app entière » est atteint en résident sur l'exploration et au retour en
vue d'ensemble (516 / 500 / 498 Mo) ; à 100 % juste après le zoom, le résident médian reste à 657 Mo (renderer
≈ 300 Mo résident dont ≈ 100 Mo de code partagé, plancher Electron ≈ 375 Mo) : cible **non tenue à cette étape**,
voir « Points ouverts ». En empreinte physique (ce que montre le Moniteur d'activité), la toile passe de
1,0–1,4 Go à 0,43–0,68 Go à toutes les étapes. Aucune perte de fluidité ; le pic de 100 ms au dézoom disparaît.

### Ce qui a changé

1. **Variante d'image explicite** (`MediaNodes.tsx`, `pickSpaceVariant`) : `src` choisi selon
   `node.width × palier(zoom × DPR)` : vignette 800w jusqu'à 960 px physiques (agrandissement ≤ 1,2, invisible
   sur une photo), `large` 1440w au-delà, jamais l'original. L'ancien `srcset` recevait une largeur **déjà
   multipliée par le DPR** (le navigateur la remultipliait : 1440w dès 100 % en Retina) et gardait la 1440w en
   cache une fois chargée, même revenu en vue d'ensemble. `decoding="async"`, `loading="lazy"`.
2. **Images hors écran** : le culling démonte déjà les nœuds hors du rectangle vue + 50 % (hystérésis ≤ 4 × la
   vue) : l'image est libérée avec le nœud (12 nœuds montés pendant l'exploration). Mesuré : resserrer
   l'hystérésis (80 → 27 nœuds montés à 100 %) ne change pas la mémoire et rapproche les montages pendant le
   zoom ; laissé tel quel.
3. **Vidéos** : affiche tant qu'une vidéo n'est ni survolée, ni sélectionnée, ni grande à l'écran
   (≥ 480 px CSS) ; **2 lecteurs actifs au plus** (3 avant) ; lecteur libéré au démontage (`releaseOnUnmount`).
4. **Budgets GPU de Chromium** (`src/main/bootstrap/memory.ts`, avant `ready`) : tuiles du compositeur 96 Mo
   (≈ 4 écrans Retina), cache GPU des images décodées 64 Mo. C'est l'essentiel du gain en empreinte (GPU
   1 000 → 251 Mo à 100 %). Mesures A/B : `RECOLTOS_GPU_TILE_MB` / `RECOLTOS_GPU_DISCARDABLE_MB` (`0` = défaut
   Chromium). Essais : tuiles 128 Mo → exploration 724 Mo ; cache 96 Mo → exploration 754 Mo.
5. **Renderer minifié** (`electron.vite.config.ts`) : 1,59 Mo → 0,66 Mo pour les deux chunks chargés au démarrage.

## Grille : défilement, tas, cycles (`tests/perf/grid.spec.ts`)

Build de production non empaqueté (`out/`, Playwright), 1512 × 945 à DSF 2. Défilement continu 5 s
(≈ 2 400 px/s, aller-retour), puis défilement complet, 20 ouvertures de la vue détail, 5 cycles de 4 ouvertures.

| Bibliothèque         | fps | p95 / p99      | images > 50 ms | longtasks > 100 ms | tas après défilement + 20 détails | croissance sur 5 cycles |
| -------------------- | --- | -------------- | -------------- | ------------------ | --------------------------------- | ----------------------- |
| Réelle, 408 — avant  | 60  | 17,3 / 17,6 ms | 0 %            | 0                  | 10,9 Mo                           | 0,9 %                   |
| Réelle, 408 — après  | 60  | 17,6 / 17,7 ms | 0 %            | 0                  | 10,6 Mo                           | 0 %                     |
| Banc, 10 000 — avant | 60  | 17,3 / 17,5 ms | 0 %            | 0                  | 17,5 Mo                           | 0,6 %                   |
| Banc, 10 000 — après | 60  | 17,6 / 17,6 ms | 0 %            | 0                  | 17,3 Mo                           | 0,6 %                   |

Budgets : ≥ 55 fps, p95 ≤ 22 ms, p99 ≤ 40 ms, 0 longtask > 100 ms, tas renderer < 400 Mo, croissance < 15 % :
**tenus**. Caches du renderer désormais bornés (hauteurs de posts 20 000, diapositives 300 carrousels, tiroir de
la toile 2 000 cartes) ; l'aperçu vidéo de survol est libéré à la fin du survol (`releaseDetached`, vérifié).

## Requêtes (main, sans IPC) : `scripts/bench-queries.mts`

50 répétitions après 5 d'échauffement, base ouverte en lecture seule ; p50 / p95 en ms.

| Requête                            | 10 000 avant | 10 000 après    | Réelle 408 après | Budget         |
| ---------------------------------- | ------------ | --------------- | ---------------- | -------------- |
| Page de liste (100, récents)       | 2,27 / 3,28  | **1,01 / 1,45** | 0,31 / 0,50      | < 5 (p95 < 20) |
| Page suivante (curseur)            | 2,10 / 3,18  | 1,00 / 1,64     | 0,31 / 0,68      | < 5            |
| Onglet « Enregistrés »             | 2,58 / 3,69  | 1,74 / 2,46     | 0,38 / 0,81      | < 5            |
| Tri par nom                        | 2,41 / 3,36  | 0,96 / 1,58     | 0,29 / 0,50      | < 5            |
| Compteurs (sans cache)             | 2,27 / 3,31  | 2,05 / 2,55     | 0,08 / 0,11      | < 5            |
| FTS, un mot                        | 1,60 / 2,13  | 1,45 / 1,80     | 0,07 / 0,10      | < 20 (< 30)    |
| FTS, préfixe 3 lettres             | 1,56 / 2,08  | 1,38 / 1,56     | 0,19 / 0,41      | < 20           |
| FTS « instagram » (source d'abord) | 7,05 / 9,73  | 5,21 / 6,32     | 0,72 / 0,98      | < 20           |

Correction : le total d'une page était compté à travers les `LEFT JOIN` de la carte (média de couverture,
auteur) ; il est compté sur `items` seul (`queries/list.ts`), −1,3 ms par page à 10 000. Plans
(`EXPLAIN QUERY PLAN`) : liste par `ix_items_live_created`, « Enregistrés » + `ix_ci_item` couvrant, FTS par
l'index virtuel puis clé primaire. `PRAGMA optimize` 0,03 ms et `wal_checkpoint(TRUNCATE)` 0,07 ms à 10 000.
À travers l'IPC (G2, build non empaqueté qui valide les sorties zod en dev) : page 10 000 p50 9–10 ms, FTS
≤ 6 ms ; le build packagé ne valide pas les sorties.

## Démarrage de l'app packagée : `scripts/perf-startup.mts`

`process.uptime()` du main à la marque `grid-painted` (première image de la grille avec des cartes, deux rAF),
bibliothèque réelle (clone), un lancement d'échauffement puis 5 mesurés, app quittée entre deux.

| Build                                             | Médiane |    Max | `app-mounted` (médiane) |
| ------------------------------------------------- | ------: | -----: | ----------------------: |
| Avant (packagé, ad hoc)                           |  709 ms | 715 ms |                  432 ms |
| Après (packagé, « RecoltOS Local », fuses fermés) |  704 ms | 719 ms |                  439 ms |

Budget < 2 s médiane / < 2,5 s max : **tenu**. Les écrans lourds sont déjà chargés à la demande
(`shell/routes.tsx` : Spaces, éditeur, Rediscover, Réglages, palette, vue détail, étagère, recherche sont des
chunks `lazy` ; seuls `index` et `globals` sont préchargés). La minification n'a pas d'effet mesurable sur ce
démarrage (≈ 0,7 s, dominé par Electron et l'ouverture de la base).

## Paquet (WP-72) : `pnpm run dist`, `scripts/check-dist.mts`

Build livré `dist/mac-arm64/RecoltOS.app`, arm64, signé « RecoltOS Local » (exigence désignée
`identifier "com.recoltos.app" and certificate leaf = H"f300b0e4…"`, identique d'un build à l'autre), hôte natif
signé avec la même identité. Fuses lus : `RunAsNode`, `EnableNodeCliInspectArguments`,
`EnableNodeOptionsEnvironmentVariable`, `EnableEmbeddedAsarIntegrityValidation` **désactivés**,
`OnlyLoadAppFromAsar` activé. `Info.plist` : `LSHandlerRank = Alternate`, `CFBundleTypeRole = Viewer`.
Le profil `pnpm run dist:test` (fuses ouverts, pour Playwright) sort dans `dist/test/` et ne remplace jamais le
build livré ; `test:packaged` couvre les deux (grille rendue sur le build livré par la marque `grid-painted`,
hôte natif `ping` → `pong` et `hello` → `hello.ack`).

| Élément                                               | Avant M7 |    Après | Budget figé |
| ----------------------------------------------------- | -------: | -------: | ----------: |
| `.app`                                                |   372 Mo | 370,1 Mo |      400 Mo |
| `app.asar`                                            |   4,7 Mo |   2,7 Mo |        4 Mo |
| `app.asar.unpacked` (better-sqlite3, sharp + libvips) |  20,2 Mo |  20,0 Mo |       22 Mo |
| Hôte natif SEA (`recolt-host`, binaire Node complet)  | 106,8 Mo | 106,8 Mo |      115 Mo |
| Extension (Chromium + Firefox)                        |   0,3 Mo |   0,2 Mo |        1 Mo |
| Electron Framework                                    |   238 Mo |   238 Mo |           — |

Retiré du paquet : `node-addon-api` (en-têtes de compilation), sources et script d'installation de sharp,
déclarations TypeScript, fichiers gyp / en-têtes C, README / CHANGELOG des dépendances, chargeurs
better-sqlite3 des autres plateformes, `out/.build-hash` ; renderer minifié. Extension : branches de test
(auto-test, points d'accès du faux serveur) éliminées du build livré (`minifySyntax`, identifiants lisibles
conservés). L'hôte natif est un binaire Node officiel complet (SEA) : l'essentiel de son poids, non réductible
sans changer de technique.

## Reproduire

```sh
# Toile (S1), Retina, médiane de N : relancer avec un clone neuf à chaque fois
cp -c -R .tmp/m3-real .tmp/m7-s1
RECOLTOS_S1_DSF=2 RECOLTOS_S1_USERDATA=$PWD/.tmp/m7-s1 pnpm exec playwright test --project=perf tests/perf/spaces.spec.ts -g S1
# Grille et requêtes IPC, réelle puis 10 000
cp -c -R .tmp/m3-real .tmp/m7-grid
RECOLTOS_PERF_DSF=2 RECOLTOS_PERF_USERDATA=$PWD/.tmp/m7-grid pnpm exec playwright test --project=perf tests/perf/grid.spec.ts
pnpm exec tsx --tsconfig tsconfig.node.json scripts/seed-bench.mts --out $PWD/.tmp/m7-bench --force
# Requêtes main
pnpm exec tsx --tsconfig tsconfig.node.json scripts/bench-queries.mts --db .tmp/m7-bench/libraries/default/recolt.db
# Démarrage (app packagée)
cp -c -R .tmp/m3-real .tmp/m7-startup
pnpm exec tsx --tsconfig tsconfig.node.json scripts/perf-startup.mts --user-data .tmp/m7-startup --runs 5
```

## Points ouverts

- Toile à 100 % juste après un zoom : résident médian 657 Mo (> 600). Le reste est le renderer (≈ 300 Mo
  résident, ≈ 220 Mo d'empreinte : Blink, cache d'images décodées côté renderer) ; une pression mémoire simulée
  n'en libère que ≈ 40 Mo. Leviers non retenus : vignettes plus petites (dérivé 400w) pour la vue
  d'ensemble, décodage à l'échelle (Blink ne le fait que pour le JPEG, nos vignettes sont en WebP).
- Assets de la toile (`ImageNode`, images déposées) : pas de variante 1440w ; l'original n'est chargé que
  quand la vignette 800 ne suffit plus (> 800 px physiques). Une variante `large` des assets côté main
  supprimerait ce cas.
- Les budgets GPU sont des commutateurs Chromium (`force-gpu-mem-*`) : à revérifier à chaque mise à jour
  d'Electron (si un commutateur disparaît, la mémoire GPU remonte sans autre symptôme).
