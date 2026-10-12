# Performances

Budgets, protocoles de mesure et ordres de grandeur relevés sur un MacBook Pro Apple Silicon (écran
Retina, macOS 27, Electron 44). Les chiffres sont indicatifs : ils dépendent de la machine, de la
bibliothèque et de la version d'Electron. Chaque chiffre mémoire est une médiane de 3 exécutions (bruit
d'une exécution à l'autre : ±40 à ±100 Mo).

## Deux mesures de mémoire, à ne pas confondre

| Mesure                          | Source                                                                             | Ce qu'elle compte                                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Résident** (`workingSetSize`) | `app.getAppMetrics()`, somme des processus                                         | Pages résidentes, **y compris le code partagé d'Electron compté une fois par processus** (≈ 100 Mo par processus). Plancher d'une app Electron vide (une fenêtre, Retina) : 304–375 Mo. |
| **Empreinte physique**          | `top -stats mem` (colonne « Mémoire » du Moniteur d'activité), somme des processus | Mémoire privée + compressée + **textures GPU (IOSurface/Metal)**, invisibles dans le résident. App Electron vide : ≈ 100 Mo.                                                            |

Le résident ignore les textures du processus GPU, qui sont le vrai poste sur la toile Spaces. Les deux
mesures sont relevées par `tests/perf/spaces.spec.ts`.

## Toile Spaces : 500 nœuds, Retina

Protocole : copie d'une bibliothèque d'environ 400 éléments, fenêtre 1512 × 945 à DSF 2, space de
500 nœuds `item` (480 images + 20 vidéos, grille 25 × 20). Étapes : bibliothèque (grille) avant d'ouvrir
la toile ; vue d'ensemble (⇧1, 500 nœuds visibles) ; 100 % (⌘0) après pan et zoom à la molette ;
exploration de 12 arrêts à 150 % ; retour en vue d'ensemble.

| Étape                    | Résident (Mo) | Empreinte (Mo) | dont GPU (Mo) |
| ------------------------ | ------------: | -------------: | ------------: |
| Bibliothèque             |       516–567 |        458–563 |         ≈ 270 |
| Vue d'ensemble           |       584–620 |        430–450 |         ≈ 175 |
| 100 % après pan/zoom     |       630–720 |        583–611 |         ≈ 255 |
| Exploration à 150 %      |       644–681 |        633–699 |         ≈ 385 |
| Retour en vue d'ensemble |       610–632 |        546–553 |         ≈ 275 |

Fluidité : 60 fps au pan et au zoom (vue d'ensemble et 100 %), p95 ≈ 17,6 ms.

Ce qui tient la mémoire :

1. **Variante d'image explicite** (`MediaNodes.tsx`, `pickSpaceVariant`) : `src` choisi selon
   `node.width × palier(zoom × DPR)` : vignette 800w jusqu'à 960 px physiques, `large` 1440w au-delà,
   jamais l'original. `decoding="async"`, `loading="lazy"`.
2. **Culling** : les nœuds hors du rectangle vue + 50 % (hystérésis ≤ 4 × la vue) sont démontés, et
   leur image libérée avec eux.
3. **Vidéos** : affiche tant qu'une vidéo n'est ni survolée, ni sélectionnée, ni grande à l'écran
   (≥ 480 px CSS) ; **2 lecteurs actifs au plus** ; lecteur libéré au démontage.
4. **Budgets GPU de Chromium** (`src/main/bootstrap/memory.ts`, avant `ready`) : tuiles du compositeur
   96 Mo, cache GPU des images décodées 64 Mo. Mesures A/B : `RECOLTOS_GPU_TILE_MB` /
   `RECOLTOS_GPU_DISCARDABLE_MB` (`0` = défaut Chromium).
5. **Renderer minifié** (`electron.vite.config.ts`).

## Grille : défilement, tas, cycles (`tests/perf/grid.spec.ts`)

Build de production non empaqueté (`out/`, Playwright), 1512 × 945 à DSF 2. Défilement continu 5 s
(≈ 2 400 px/s, aller-retour), puis défilement complet, 20 ouvertures de la vue détail, 5 cycles de 4
ouvertures.

| Bibliothèque    | fps | p95 / p99      | images > 50 ms | longtasks > 100 ms | tas après défilement + 20 détails | croissance sur 5 cycles |
| --------------- | --- | -------------- | -------------- | ------------------ | --------------------------------- | ----------------------- |
| ≈ 400 éléments  | 60  | 17,6 / 17,7 ms | 0 %            | 0                  | 10,6 Mo                           | 0 %                     |
| 10 000 éléments | 60  | 17,6 / 17,6 ms | 0 %            | 0                  | 17,3 Mo                           | 0,6 %                   |

Budgets : ≥ 55 fps, p95 ≤ 22 ms, p99 ≤ 40 ms, 0 longtask > 100 ms, tas renderer < 400 Mo, croissance
< 15 %. Les caches du renderer sont bornés (hauteurs de posts 20 000, diapositives 300 carrousels,
tiroir de la toile 2 000 cartes).

## Requêtes (main, sans IPC) : `scripts/bench-queries.mts`

50 répétitions après 5 d'échauffement, base ouverte en lecture seule ; p50 / p95 en ms.

| Requête                            | 10 000 éléments | ≈ 400 éléments | Budget         |
| ---------------------------------- | --------------- | -------------- | -------------- |
| Page de liste (100, récents)       | 1,01 / 1,45     | 0,31 / 0,50    | < 5 (p95 < 20) |
| Page suivante (curseur)            | 1,00 / 1,64     | 0,31 / 0,68    | < 5            |
| Onglet « Enregistrés »             | 1,74 / 2,46     | 0,38 / 0,81    | < 5            |
| Tri par nom                        | 0,96 / 1,58     | 0,29 / 0,50    | < 5            |
| Compteurs (sans cache)             | 2,05 / 2,55     | 0,08 / 0,11    | < 5            |
| FTS, un mot                        | 1,45 / 1,80     | 0,07 / 0,10    | < 20 (< 30)    |
| FTS, préfixe 3 lettres             | 1,38 / 1,56     | 0,19 / 0,41    | < 20           |
| FTS « instagram » (source d'abord) | 5,21 / 6,32     | 0,72 / 0,98    | < 20           |

Plans (`EXPLAIN QUERY PLAN`) : liste par `ix_items_live_created`, « Enregistrés » + `ix_ci_item`
couvrant, FTS par l'index virtuel puis clé primaire. À travers l'IPC (build non empaqueté qui valide
les sorties zod en dev) : page à 10 000 éléments p50 9–10 ms, FTS ≤ 6 ms ; le build packagé ne valide
pas les sorties.

## Démarrage de l'app packagée : `scripts/perf-startup.mts`

`process.uptime()` du main à la marque `grid-painted` (première image de la grille avec des cartes,
deux rAF), un lancement d'échauffement puis 5 mesurés, app quittée entre deux : médiane ≈ 0,7 s.
Budget : < 2 s en médiane, < 2,5 s au maximum. Les écrans lourds sont chargés à la demande
(`shell/routes.tsx`).

## Paquet : `pnpm run dist`, `scripts/check-dist.mts`

Build livré `dist/mac-arm64/RecoltOS.app`, arm64, signé avec l'identité locale (exigence désignée
`identifier "com.recoltos.app" and certificate leaf = H"…"`), hôte natif signé avec la même identité.
Fuses : `RunAsNode`, `EnableNodeCliInspectArguments`, `EnableNodeOptionsEnvironmentVariable`,
`EnableEmbeddedAsarIntegrityValidation` **désactivés**, `OnlyLoadAppFromAsar` activé. Le profil
`pnpm run dist:test` (fuses ouverts, pour Playwright) sort dans `dist/test/` et ne remplace jamais le
build livré.

| Élément                                               |   Taille | Budget figé |
| ----------------------------------------------------- | -------: | ----------: |
| `.app`                                                | 370,1 Mo |      400 Mo |
| `app.asar`                                            |   2,7 Mo |        4 Mo |
| `app.asar.unpacked` (better-sqlite3, sharp + libvips) |  20,0 Mo |       22 Mo |
| Hôte natif SEA (`recolt-host`, binaire Node complet)  | 106,8 Mo |      115 Mo |
| Extension (Chromium + Firefox)                        |   0,2 Mo |        1 Mo |
| Electron Framework                                    |   238 Mo |           — |

Retiré du paquet : en-têtes de compilation, sources et scripts d'installation des modules natifs,
déclarations TypeScript, README / CHANGELOG des dépendances, chargeurs natifs des autres plateformes.
L'hôte natif est un binaire Node officiel complet (SEA) : l'essentiel de son poids.

## Reproduire

Les mesures sur une bibliothèque réelle se font toujours sur une **copie** (jamais le dossier
`~/Library/Application Support/RecoltOS`) ; sans copie, les tests utilisent une bibliothèque de
démonstration.

```sh
# Toile Spaces, Retina : relancer avec une copie neuve à chaque fois
cp -c -R <copie-userData> .tmp/perf-s1
RECOLTOS_S1_DSF=2 RECOLTOS_S1_USERDATA=$PWD/.tmp/perf-s1 pnpm exec playwright test --project=perf tests/perf/spaces.spec.ts -g S1
# Grille et requêtes IPC
cp -c -R <copie-userData> .tmp/perf-grid
RECOLTOS_PERF_DSF=2 RECOLTOS_PERF_USERDATA=$PWD/.tmp/perf-grid pnpm exec playwright test --project=perf tests/perf/grid.spec.ts
# Banc synthétique de 10 000 éléments, puis requêtes main
pnpm exec tsx --tsconfig tsconfig.node.json scripts/seed-bench.mts --out $PWD/.tmp/perf-bench --force
pnpm exec tsx --tsconfig tsconfig.node.json scripts/bench-queries.mts --db .tmp/perf-bench/libraries/default/recolt.db
# Démarrage (app packagée)
cp -c -R <copie-userData> .tmp/perf-startup
pnpm exec tsx --tsconfig tsconfig.node.json scripts/perf-startup.mts --user-data .tmp/perf-startup --runs 5
```

## Points ouverts

- Résident de la toile encore > 600 Mo dans la plupart des exécutions. Le reste est surtout le renderer
  (Blink, cache d'images décodées). Pistes non retenues : vignettes plus petites (400w) pour la vue
  d'ensemble, décodage à l'échelle (Blink ne le fait que pour le JPEG).
- Assets de la toile (images déposées) : pas de variante 1440w ; l'original n'est chargé que quand la
  vignette 800 ne suffit plus.
- Les budgets GPU sont des commutateurs Chromium (`force-gpu-mem-*`) : à revérifier à chaque mise à jour
  d'Electron.
