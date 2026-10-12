# Performance

Budgets, measurement protocols and orders of magnitude recorded on an Apple Silicon MacBook Pro
(Retina display, macOS 27, Electron 44). The figures are indicative: they depend on the machine, the
library and the Electron version. Each memory figure is the median of 3 runs (run-to-run noise:
±40 to ±100 MB).

## Two memory measures, not to be confused

| Measure                         | Source                                                                     | What it counts                                                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Resident** (`workingSetSize`) | `app.getAppMetrics()`, sum over processes                                  | Resident pages, **including Electron's shared code counted once per process** (≈ 100 MB per process). Floor for an empty Electron app (one window, Retina): 304–375 MB. |
| **Physical footprint**          | `top -stats mem` ("Memory" column in Activity Monitor), sum over processes | Private memory + compressed memory + **GPU textures (IOSurface/Metal)**, which are invisible in the resident figure. Empty Electron app: ≈ 100 MB.                      |

The resident figure ignores the GPU process's textures, which are the real cost on the Spaces canvas.
Both measures are recorded by `tests/perf/spaces.spec.ts`.

## Spaces canvas: 500 nodes, Retina

Protocol: copy of a library of about 400 items, 1512 × 945 window at DSF 2, a space of 500 `item`
nodes (480 images + 20 videos, 25 × 20 grid). Steps: library (grid) before opening the canvas;
overview (⇧1, 500 nodes visible); 100% (⌘0) after panning and zooming with the wheel; exploring 12
stops at 150%; back to the overview.

| Step                 | Resident (MB) | Footprint (MB) | of which GPU (MB) |
| -------------------- | ------------: | -------------: | ----------------: |
| Library              |       516–567 |        458–563 |             ≈ 270 |
| Overview             |       584–620 |        430–450 |             ≈ 175 |
| 100% after pan/zoom  |       630–720 |        583–611 |             ≈ 255 |
| Exploring at 150%    |       644–681 |        633–699 |             ≈ 385 |
| Back to the overview |       610–632 |        546–553 |             ≈ 275 |

Smoothness: 60 fps while panning and zooming (overview and 100%), p95 ≈ 17.6 ms.

What keeps memory down:

1. **Explicit image variant** (`MediaNodes.tsx`, `pickSpaceVariant`): `src` is chosen from
   `node.width × tier(zoom × DPR)`: the 800w thumbnail up to 960 physical px, `large` 1440w beyond
   that, never the original. `decoding="async"`, `loading="lazy"`.
2. **Culling**: nodes outside the view rectangle + 50% (hysteresis ≤ 4 × the view) are unmounted, and
   their image is released with them.
3. **Videos**: a poster is shown until a video is hovered, selected or large on screen (≥ 480 CSS px);
   **at most 2 active players**; a player is released on unmount.
4. **Chromium GPU budgets** (`src/main/bootstrap/memory.ts`): no cap by default anymore. The 96 MB of
   tiles / 64 MB of decoded images first set for the canvas left the detail view short of tiles on
   Retina (dark flat areas during navigation). A/B measurements: `RECOLTOS_GPU_TILE_MB` /
   `RECOLTOS_GPU_DISCARDABLE_MB` (`0` or unset = Chromium default).
5. **Minified renderer** (`electron.vite.config.ts`).

## Grid: scrolling, heap, cycles (`tests/perf/grid.spec.ts`)

Unpackaged production build (`out/`, Playwright), 1512 × 945 at DSF 2. Continuous scrolling for 5 s
(≈ 2,400 px/s, back and forth), then a full scroll, 20 openings of the detail view, 5 cycles of 4
openings.

| Library      | fps | p95 / p99      | frames > 50 ms | longtasks > 100 ms | heap after scrolling + 20 detail views | growth over 5 cycles |
| ------------ | --- | -------------- | -------------- | ------------------ | -------------------------------------- | -------------------- |
| ≈ 400 items  | 60  | 17.6 / 17.7 ms | 0%             | 0                  | 10.6 MB                                | 0%                   |
| 10,000 items | 60  | 17.6 / 17.6 ms | 0%             | 0                  | 17.3 MB                                | 0.6%                 |

Budgets: ≥ 55 fps, p95 ≤ 22 ms, p99 ≤ 40 ms, 0 longtasks > 100 ms, renderer heap < 400 MB, growth
< 15%. The renderer caches are bounded (post heights 20,000, 300 carousel slides, canvas drawer
2,000 cards).

## Queries (main process, no IPC): `scripts/bench-queries.mts`

50 repetitions after 5 warm-up runs, database opened read-only; p50 / p95 in ms.

| Query                          | 10,000 items | ≈ 400 items | Budget         |
| ------------------------------ | ------------ | ----------- | -------------- |
| List page (100, most recent)   | 1.01 / 1.45  | 0.31 / 0.50 | < 5 (p95 < 20) |
| Next page (cursor)             | 1.00 / 1.64  | 0.31 / 0.68 | < 5            |
| "Saved" tab                    | 1.74 / 2.46  | 0.38 / 0.81 | < 5            |
| Sort by name                   | 0.96 / 1.58  | 0.29 / 0.50 | < 5            |
| Counters (no cache)            | 2.05 / 2.55  | 0.08 / 0.11 | < 5            |
| FTS, one word                  | 1.45 / 1.80  | 0.07 / 0.10 | < 20 (< 30)    |
| FTS, 3-letter prefix           | 1.38 / 1.56  | 0.19 / 0.41 | < 20           |
| FTS "instagram" (source first) | 5.21 / 6.32  | 0.72 / 0.98 | < 20           |

Plans (`EXPLAIN QUERY PLAN`): list through `ix_items_live_created`, "Saved" + covering `ix_ci_item`,
FTS through the virtual index then the primary key. Through IPC (unpackaged build, which validates zod
outputs in dev): a page at 10,000 items p50 9–10 ms, FTS ≤ 6 ms; the packaged build does not validate
outputs.

## Packaged app startup: `scripts/perf-startup.mts`

`process.uptime()` of the main process at the `grid-painted` mark (first grid frame with cards, two
rAF), one warm-up launch then 5 measured ones, app quit between runs: median ≈ 0.7 s. Budget: < 2 s
median, < 2.5 s maximum. Heavy screens are loaded on demand (`shell/routes.tsx`).

## Package: `pnpm run dist`, `scripts/check-dist.mts`

Shipped build `dist/mac-arm64/RecoltOS.app`, arm64, signed with the local identity (designated
requirement `identifier "com.recoltos.app" and certificate leaf = H"…"`), native host signed with the
same identity. Fuses: `RunAsNode`, `EnableNodeCliInspectArguments`,
`EnableNodeOptionsEnvironmentVariable`, `EnableEmbeddedAsarIntegrityValidation` **disabled**,
`OnlyLoadAppFromAsar` enabled. The `pnpm run dist:test` profile (open fuses, for Playwright) outputs
to `dist/test/` and never replaces the shipped build.

| Item                                                  |     Size | Frozen budget |
| ----------------------------------------------------- | -------: | ------------: |
| `.app`                                                | 370.1 MB |        400 MB |
| `app.asar`                                            |   2.7 MB |          4 MB |
| `app.asar.unpacked` (better-sqlite3, sharp + libvips) |  20.0 MB |         22 MB |
| SEA native host (`recolt-host`, full Node binary)     | 106.8 MB |        115 MB |
| Extension (Chromium + Firefox)                        |   0.2 MB |          1 MB |
| Electron Framework                                    |   238 MB |             — |

Removed from the package: build headers, sources and install scripts of native modules, TypeScript
declarations, dependency READMEs / CHANGELOGs, native loaders for other platforms. The native host is
a full official Node binary (SEA), which accounts for most of its size.

## Reproduce

Measurements on a real library are always done on a **copy** (never the
`~/Library/Application Support/RecoltOS` folder); without a copy, the tests use a demo library.

```sh
# Spaces canvas, Retina: rerun with a fresh copy each time
cp -c -R <userData-copy> .tmp/perf-s1
RECOLTOS_S1_DSF=2 RECOLTOS_S1_USERDATA=$PWD/.tmp/perf-s1 pnpm exec playwright test --project=perf tests/perf/spaces.spec.ts -g S1
# Grid and IPC queries
cp -c -R <userData-copy> .tmp/perf-grid
RECOLTOS_PERF_DSF=2 RECOLTOS_PERF_USERDATA=$PWD/.tmp/perf-grid pnpm exec playwright test --project=perf tests/perf/grid.spec.ts
# Synthetic 10,000-item bench, then main-process queries
pnpm exec tsx --tsconfig tsconfig.node.json scripts/seed-bench.mts --out $PWD/.tmp/perf-bench --force
pnpm exec tsx --tsconfig tsconfig.node.json scripts/bench-queries.mts --db .tmp/perf-bench/libraries/default/recolt.db
# Startup (packaged app)
cp -c -R <userData-copy> .tmp/perf-startup
pnpm exec tsx --tsconfig tsconfig.node.json scripts/perf-startup.mts --user-data .tmp/perf-startup --runs 5
```

## Open points

- Canvas resident memory is still > 600 MB in most runs. The rest is mostly the renderer (Blink,
  decoded image cache). Options not adopted: smaller thumbnails (400w) for the overview, scaled
  decoding (Blink only does it for JPEG).
- Canvas assets (dropped images): no 1440w variant; the original is only loaded when the 800
  thumbnail is no longer enough.
- The GPU budgets are Chromium switches (`force-gpu-mem-*`): recheck them at each Electron update.
