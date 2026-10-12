# Manual test checklist

What the automated tests cannot prove: macOS permissions, a real browser, real accounts, hardware, AI
billed to your subscription. Run it **in order** on a **signed, packaged build** (preferably with the
local "RecoltOS Local" certificate, see `docs/signature.md`) before a release.

Rule: check a box only if the behavior was **seen**, never inferred. Note each deviation (step,
message shown, log) in an issue.

Already covered automatically (do not redo): `pnpm run verify` (including the full walkthrough in
`tests/e2e/security.spec.ts`: 0 external requests, 0 CSP violations, no `ct0` / `sessionid` /
`Bearer` on disk), `pnpm run dist` (fuses checked by `check:dist`), `pnpm run test:packaged`
(grid rendered by the shipped app, round trip through the packaged native host).

- **Run**: date `____-__-__` · build (`git rev-parse --short HEAD`) `________`
- **Preconditions**: `RECOLTOS_USER_DATA` not set; certificate present if you sign
  (`security find-identity -v -p codesigning`).

## 1. Installing in /Applications

```sh
RECOLTOS_SIGN_IDENTITY="RecoltOS Local" pnpm run dist   # verify:fast + pack + check:dist
pnpm run app:install                                    # copies to /Applications and launches
```

- [ ] `pnpm run app:install` copies to `/Applications`; the app launches from the Dock.
- [ ] `codesign -dvv /Applications/RecoltOS.app 2>&1 | grep Authority` shows the expected identity.
- [ ] `codesign -dr - /Applications/RecoltOS.app` is identical across two successive builds (repeat `dist` + `app:install`, compare).
- [ ] Data only under `~/Library/Application Support/RecoltOS`.
- [ ] Startup feels < 2 s; the grid scrolls smoothly (automated measurements: `docs/perf.md`).

## 2. Screen capture and adding items

Permission: ⌘⇧S → "Screen Recording" prompt (or the RecoltOS guide) → System Settings › Privacy &
Security › Screen & System Audio Recording → turn on **RecoltOS** → "Relaunch RecoltOS". To start
over: `tccutil reset ScreenCapture com.recoltos.app`.

- [ ] Settings › Capture: "Screen Recording: Allowed".
- [ ] The global ⌘⇧S triggers a capture, with the app in the foreground **and** in the background.
- [ ] Area mode: select with the mouse, Esc cancels, the item appears in the library.
- [ ] Drop folder: choosing the Desktop triggers the access prompt; the "RecoltOS Capture … at …" PNG (English interface) is written there.
- [ ] **Permission stable across two builds** (same identity): the prompt does not come back and ⌘⇧S captures directly.
- [ ] Shortcut changed on the fly; a shortcut already taken shows a conflict message.
- [ ] With all windows closed (⌘W): ⌘⇧S still captures; the "Capture added" notification reopens the item.
- [ ] ⌃ during selection: the image is taken from the clipboard.
- [ ] Capturing an image that is already present: "Already in your library".
- [ ] "Open With" from the Finder (1 file, then N files); dropping on the Dock icon, with the app closed.

## 3. Extension and sync

Detailed procedure: `docs/extension.md`. Sync uses unofficial requests with your session: test it on
an account whose risk you accept (see the warnings in the README).

**A. Firefox extension**

- [ ] App launched once: `~/Library/Application Support/Mozilla/NativeMessagingHosts/com.recoltos.host.json` exists.
- [ ] **Temporary loading**: `about:debugging#/runtime/this-firefox` › "Load Temporary Add-on…" › `~/Library/Application Support/RecoltOS/extension/firefox/manifest.json`.
- [ ] **Signed version** (optional): `pnpm run build:ext && pnpm run sign:firefox` with your AMO credentials, then `pnpm run dist && pnpm run app:install`; drag `dist-extension/signed/*.xpi` into Firefox. The extension survives a restart.
- [ ] about:addons › RecoltOS › Permissions: x.com, instagram.com, cosmos.so (and CDNs) allowed.
- [ ] Extension button: "● Connected to RecoltOS"; Settings › Sync: "Connected — Firefox".

**B. Sync, tabs closed**

Be signed in to the site in the browser, then **close all tabs** of that site before "Sync Now".

- [ ] X, Instagram, Cosmos: the first sync adds items; no tab opens; the log ("…" › View Log) says "background".
- [ ] No duplicates on the next sync; older items that were recovered are reported ("N older posts recovered · Review").
- [ ] A bookmark added on x.com appears within 30 s; a bookmark added from another device appears within 15 min, with the browser open.
- [ ] Instagram: a 10-item carousel produces one item with the 1/10 badge; no "checkpoint".
- [ ] If X answers "X is refusing the extension's request": open x.com/i/bookmarks once and note the log message.
- [ ] Browser quit: the row shows "Browser closed: sync will resume when it opens".

**C. Chromium and robustness**

- [ ] Chrome / Brave: "Load unpacked" › `~/Library/Application Support/RecoltOS/extension/chromium/`; button "● Connected to RecoltOS".
- [ ] Right-click an image › "Save to RecoltOS": item created in under 2 s, toast.
- [ ] App closed: right-click an image › "RecoltOS is closed: added at next launch"; the item appears at the next launch.
- [ ] Permanently deleting a synced item: not reimported (including "Resync Everything").
- [ ] No secrets on disk after a real sync:
      `grep -rIl -E 'ct0=|sessionid=|Bearer [A-Za-z0-9]' ~/Library/Application\ Support/RecoltOS` returns nothing.
- [ ] `/Applications/RecoltOS.app/Contents/MacOS/RecoltOS --uninstall-native-hosts` removes `com.recoltos.host.json` and nothing else
      (`find ~/Library/Application\ Support -maxdepth 4 -name '*.host.json'`).

## 4. Interface

- [ ] Quick Look (Space) on an image, a video and a post.
- [ ] Dragging a selection of files from the Finder into the window = import (report "N added · M duplicates · 0 failures").
- [ ] Dragging a card to the Finder (the original file is copied) and to a collection.
- [ ] Drag regions: the library picker menu, the palette overlay and the detail view buttons stay clickable.
- [ ] Light, dark and system themes: switching is live, no white flash at startup; traffic lights correctly placed in dark.
- [ ] No untranslated text in either interface language (English, French); no blurry image on Retina.
- [ ] ⌘W while editing a 500-node Space: nothing is lost on reopening.

## 5. AZERTY keyboard

- [ ] ⌘1 / ⌘2 / ⌘3 (Library / Collections / Spaces).
- [ ] ⌘K (palette), ⌘F (search), ⌘, (Settings).
- [ ] ⌘Z in a text field and outside one; ⌘A; ⌘+ / ⌘= / ⌘− (zoom).
- [ ] Capture shortcut on a letter: the displayed label matches the key actually pressed.

## 6. Real AI (`claude` / `codex` CLI, uses your quota)

- [ ] Settings › AI: Claude engine "Connected"; real connection test succeeds; Codex detected if installed.
- [ ] Consent requested before the first call; no call while the engine is "None".
- [ ] 5 items analyzed (image, video, post, carousel, capture): name, description in the interface language, tags and detected text are consistent.
- [ ] Same with Codex as the fallback (if installed).
- [ ] Send preview (Settings › AI › Privacy): exact files and prompt; call log up to date.
- [ ] Budget: the queue stops at the hourly limit (120/h) and resumes; "Cancel All" empties the queue.

## 7. Import from GatherOS (if a GatherOS library is present)

- [ ] Settings › Libraries › "Import from GatherOS": library detected, import finished, summary shown; the source folder is not modified.
- [ ] A second import recreates nothing.
- [ ] Turning on sync while the old app is still syncing: the coexistence warning is shown.

## Result

- [ ] All items above are checked, or each deviation is recorded in an issue.
