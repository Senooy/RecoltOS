# RecoltOS browser extension

One codebase (`extension/`), two builds:

| Target                       | Folder                     | Details                                                                        |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| Firefox (primary)            | `dist-extension/firefox/`  | MV3, `background.scripts`, ID `recoltos@local`, Firefox 142 minimum            |
| Chrome, Brave, Edge, Vivaldi | `dist-extension/chromium/` | MV3, service worker, `key` field → fixed ID `kkcpbglfgmkcjndibkbpjdiakanmbdhi` |

The extension talks to the app through **native messaging**: the browser launches the host
`RecoltOS.app/Contents/Resources/native-host/recolt-host` (a separate executable), which relays to the
app's local socket. No network port is opened. While the app is closed, saves (≤ 8 MiB) are queued and
added at the next launch.

## Build and check

```sh
pnpm run build:ext      # → dist-extension/chromium/ and dist-extension/firefox/
pnpm run lint:ext       # web-ext lint on the Firefox build (0 errors, 0 warnings)
pnpm run pack           # packaged app: embeds the host and both extensions (+ the signed .xpi if it exists)
```

On launch, the packaged app copies the extensions to a fixed path:
`~/Library/Application Support/RecoltOS/extension/{firefox,chromium}/`, and writes the native manifests
(`com.recoltos.host.json`) for each browser it finds, including
`~/Library/Application Support/Mozilla/NativeMessagingHosts/` for Firefox (`allowed_extensions`).
In development, nothing is written unless `RECOLTOS_INSTALL_DEV_HOST=1` is set (name
`com.recoltos.host.dev`).

## Firefox: signed version (permanent install)

Firefox release refuses unsigned extensions for permanent installs. "Unlisted" signing goes through
addons.mozilla.org without publishing the extension.

1. On <https://addons.mozilla.org/developers/addon/api/key/>, sign in and generate "API credentials"
   (JWT issuer and JWT secret).
2. In your terminal (keep the keys to yourself and don't write them to any file in the repository):
   ```sh
   export WEB_EXT_API_KEY='user:…'      # JWT issuer
   export WEB_EXT_API_SECRET='…'        # JWT secret
   pnpm run build:ext && pnpm run sign:firefox
   ```
   The signed file ends up in `dist-extension/signed/*.xpi`. Each new signature requires a new
   version: increase `EXTENSION_VERSION` in `src/shared/bridge/constants.ts`.
3. `pnpm run pack` embeds it. In the app, go to Settings › Sync › Install the Extension… › Firefox ›
   "Reveal Signed File".
4. Drag the `.xpi` into a Firefox window (or about:addons › ⚙️ › "Install Add-on From File…") and
   confirm.

## Firefox: temporary loading (testing)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click "Load Temporary Add-on…".
3. Choose `manifest.json` in `~/Library/Application Support/RecoltOS/extension/firefox/` (or
   `dist-extension/firefox/`).

The extension is removed when Firefox restarts.

**Permissions (Firefox MV3)**: site access is an optional permission that Firefox may leave turned
off. Check about:addons › RecoltOS › Permissions: x.com, instagram.com and cosmos.so (and their CDNs)
must be allowed. Otherwise, the extension button shows "Allow Access to Sites" and Settings › Sync
reports it for each source.

## Chrome, Brave, Edge, Vivaldi

1. Open `chrome://extensions` (Brave: `brave://extensions`, Edge: `edge://extensions`).
2. Turn on **Developer mode**.
3. Click "Load unpacked" and choose `~/Library/Application Support/RecoltOS/extension/chromium/`.

## How sync works

- It runs in the extension's **background script**, **without opening a tab**, as soon as a session is
  open (cookies present) on X, Instagram or Cosmos in that browser.
- The app does the scheduling (X every 15 min, Instagram and Cosmos every 30 min) and decides page by
  page (in incremental mode, it stops at the first item it already knows). The extension replays the
  site's requests with your cookies (CSRF token read through the `cookies` API: `ct0` for X,
  `csrftoken` for Instagram). The `Origin` and `Referer` headers are rewritten to the site's by
  `declarativeNetRequest` rules. Cookies never leave the browser.
- **Sync only runs while the browser is open.** With the browser closed, the status reads "Browser
  closed: sync will resume when it opens".
- Media is downloaded **by the app** (without cookies).
- "Open a background tab if needed" (the "…" menu of each source) is a fallback, **off by default**,
  used only if the site refuses the background request.
- **X** (web client "x-web"): the extension reads x.com's public code, without cookies, to find the ID
  of the persisted query `bookmarksQuery` (home page → entry script → routes → `bookmarks-*.js`). It
  keeps the ID in a cache and checks it again when x.com changes version. If X ever requires the
  `x-client-transaction-id` signature (which is not reproduced), the status line reads "X is refusing
  the extension's request": opening x.com/i/bookmarks picks up the bookmarks shown on the page
  (passive capture).
- **Cosmos**: being signed in to cosmos.so in the browser is enough. The extension gets the access
  token from `www.cosmos.so/api/refresh-token` (the site's session cookie, never read or sent to the
  app) and renews it before it expires. No visit to the site is needed.

## Tests

```sh
pnpm exec vitest run tests/unit/extension tests/unit/bridge tests/unit/sync   # unit tests
pnpm run test:ext            # test Chromium, throwaway profile, fake server, test app
pnpm run test:ext:firefox    # real Firefox 157, throwaway profile: loads the extension
pnpm run test:packaged       # packaged app: native host, test manifests, uninstall
```

None of these tests use your browsers, profiles, cookies or accounts.

## Uninstall the connector

`/Applications/RecoltOS.app/Contents/MacOS/RecoltOS --uninstall-native-hosts`: removes only the
`com.recoltos.host*.json` files. Other applications' manifests are never touched.
