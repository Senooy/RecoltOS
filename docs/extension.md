# RecoltOS browser extension

One codebase (`extension/`), two builds:

| Target                       | Folder                     | Details                                                                        |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| Firefox (primary)            | `dist-extension/firefox/`  | MV3, `background.scripts`, ID `recoltos@senooy.github.io`, Firefox 142 minimum |
| Chrome, Brave, Edge, Vivaldi | `dist-extension/chromium/` | MV3, service worker, `key` field → fixed ID `kkcpbglfgmkcjndibkbpjdiakanmbdhi` |

The extension talks to the app through **native messaging**: the browser launches the host
`RecoltOS.app/Contents/Resources/native-host/recolt-host` (a separate executable of about 0.4 MB,
written in Rust in `native-host/`), which relays to the app's local socket. No network port is opened. While the app is closed, saves (≤ 8 MiB) are queued and
added at the next launch.

## Build and check

```sh
pnpm run build:ext      # → dist-extension/chromium/ and dist-extension/firefox/
pnpm run lint:ext       # web-ext lint on the Firefox build (0 errors, 0 warnings)
pnpm run build:host     # → out/native-host/recolt-host (cargo build --release, then signed)
pnpm run pack           # packaged app: embeds the host and both extensions (+ the signed .xpi if it exists)
```

The native host needs Rust (stable, through [rustup](https://rustup.rs)); `native-host/rust-toolchain.toml`
selects the toolchain and the `aarch64-apple-darwin` target, and `build:host` uses rustup's `cargo` even
when another one comes first in the `PATH`. It depends on nothing but the Rust standard library. Its
protocol constants (extension IDs, size limits, ping interval) are generated from
`src/shared/bridge/constants.ts` into `native-host/src/constants.rs` at each build. `build:host` signs
it with `RECOLTOS_SIGN_IDENTITY` (ad hoc without it): with a Developer ID, hardened runtime and secure
timestamp, without any entitlement. electron-builder leaves that signature as is (`mac.signIgnore`).
`cargo test` (from `native-host/`) runs its unit tests.

On launch, the packaged app copies the extensions to a fixed path:
`~/Library/Application Support/RecoltOS/extension/{firefox,chromium}/`, and writes the native manifests
(`com.recoltos.host.json`) for each browser it finds, including
`~/Library/Application Support/Mozilla/NativeMessagingHosts/` for Firefox (`allowed_extensions`).
In development, nothing is written unless `RECOLTOS_INSTALL_DEV_HOST=1` is set (name
`com.recoltos.host.dev`).

## Install from the stores

Install and open the [RecoltOS macOS app](https://github.com/Senooy/RecoltOS/releases/latest) first.
The app registers the local native messaging connector. Then install the extension from:

- [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/recoltos/)
- [Chrome Web Store](https://chromewebstore.google.com/detail/nelpliekohgpkodffcmgcaoipncjoeei)

A listing becomes installable after its store approves it. The Firefox ID is `recoltos@senooy.github.io`; the Chrome Web Store ID is
`nelpliekohgpkodffcmgcaoipncjoeei`. The connector also accepts the old Firefox development ID
`recoltos@local` and Chromium development ID `kkcpbglfgmkcjndibkbpjdiakanmbdhi`.

In Settings › Sync, check that the browser is connected. Right-click an image and choose
“Save to RecoltOS” to test saving without a website account. Optional synchronization is unofficial
and disabled by default. See [PRIVACY.md](../PRIVACY.md) for local data handling.

## Firefox signing for development

The existing `pnpm run sign:firefox` command creates an **unlisted** signed build for development;
it does not publish a store listing. Generate AMO API credentials yourself in the Developer Hub's
Manage API Keys page and provide `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` only as environment
variables. Never put them in a file, command log or commit. Build first, then sign. Each submission
requires a new `EXTENSION_VERSION`. The signed output is in `dist-extension/signed/`.

For public releases, submit the Firefox build in the **listed** channel together with the source
archive and its `SOURCE_BUILD.md` reproduction instructions. [Store listing copy](store-listing.md)
contains the permission explanations and reviewer instructions.

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

## Chromium unpacked loading (development only)

1. Open `chrome://extensions` (Brave: `brave://extensions`, Edge: `edge://extensions`).
2. Turn on **Developer mode**.
3. Click "Load unpacked" and choose `~/Library/Application Support/RecoltOS/extension/chromium/`.

## How sync works

- After you enable a source in the app, sync runs in the extension's **background script**,
  **without opening a tab**, while you are signed in to that source in the browser.
- The app does the scheduling (X every 15 min, Instagram and Cosmos every 30 min) and decides page by
  page (in incremental mode, it stops at the first item it already knows). The extension replays the
  site's requests with your cookies (CSRF token read through the `cookies` API: `ct0` for X,
  `csrftoken` for Instagram). The `Origin` and `Referer` headers are rewritten to the site's by
  `declarativeNetRequest` rules. Cookies are used only for requests to their own service and are never sent to the app.
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
pnpm exec vitest run --project unit tests/unit/extension tests/unit/bridge # unit tests
pnpm run test:ext            # test Chromium, throwaway profile, fake server, test app
pnpm run test:ext:firefox    # real Firefox 157, throwaway profile: loads the extension
pnpm run test:packaged       # packaged app: native host, test manifests, uninstall
```

None of these tests use your browsers, profiles, cookies or accounts.

## Uninstall the connector

`/Applications/RecoltOS.app/Contents/MacOS/RecoltOS --uninstall-native-hosts`: removes only the
`com.recoltos.host*.json` files. Other applications' manifests are never touched.
