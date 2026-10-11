# RecoltOS

Bibliothèque visuelle locale pour macOS (Electron), reconstruction clean-room de GatherOS.
Pas de compte, pas de licence, pas de télémétrie. Interface en français.

## Démarrer

```sh
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0   # pnpm 12.6.0 via corepack (packageManager)
pnpm install
pnpm run dev                                # fenêtre 1280×820, coque squelette
RECOLTOS_USER_DATA="$PWD/.tmp/userdata" pnpm run dev   # données isolées (worktree, tests)
```

Toujours `pnpm run <script>` (jamais `pnpm doctor` / `pnpm rebuild`, commandes intégrées).
Le pnpm 9.15.0 de Homebrew (`/opt/homebrew/bin/pnpm`) n'est pas utilisé.

| Script                                | Rôle                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `dev`                                 | electron-vite en développement (serveur Vite + main + preload)                    |
| `build:app`                           | build de production dans `out/`                                                   |
| `typecheck` / `lint` / `format:check` | `tsc -b`, ESLint (typé), Prettier                                                 |
| `smoke:native`                        | better-sqlite3 + FTS5 + `0001_init.sql` + sharp **dans le main Electron**         |
| `rebuild:native`                      | `electron-builder install-app-deps` (repli ; les natifs sont des prebuilds N-API) |
| `verify:fast`                         | format + lint + typecheck + check:pkg + tests unitaires                           |

Variables : `RECOLTOS_USER_DATA`, `RECOLTOS_E2E=1`, `RECOLTOS_WINDOW=1280x820`, `RECOLTOS_HOME` (QA §2).

## Documents

- `docs/plan/PLAN.md` : plan (fait foi), `docs/plan/work_packages.json` : lots.
- `docs/specs/ERRATA.md` puis `docs/specs/*.md` : specs par domaine.
- `docs/CONTRATS.md` : où vivent les contrats partagés ; `docs/contrats/CHANGELOG.md` : demandes de changement.

## Clean-room

Ne jamais ouvrir `/Applications/GatherOS.app/Contents/Resources/app.asar` ni aucun code GatherOS ;
ne jamais lire, copier ni journaliser le jeton d’extension de GatherOS ; GatherOS en lecture seule.
