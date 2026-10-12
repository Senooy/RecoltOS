/** English texts for the `sync` domain (background sync without a tab, Firefox first). */
import type { Widen } from '../../../../shared/i18n/messages'
import type { SyncPlatformKey, sync as frSync } from '../fr/sync'

const SITE: Record<SyncPlatformKey, string> = {
  x: 'x.com',
  instagram: 'instagram.com',
  cosmos: 'cosmos.so',
}
const NAME: Record<SyncPlatformKey, string> = { x: 'X', instagram: 'Instagram', cosmos: 'Cosmos' }
const s = (n: number, one: string, many: string) => (n === 1 ? one : many)

export const sync: Widen<typeof frSync> = {
  syncUi: {
    names: NAME,
    sites: SITE,
    experimental: 'experimental',
    line: {
      disabled: 'Off',
      never: 'Never synced',
      running: (n: number) => `Syncing…${n ? ` ${n} ${s(n, 'item', 'items')}` : ''}`,
      backfill: (n: number) => `Fetching history…${n ? ` ${n} ${s(n, 'item', 'items')}` : ''}`,
      ok: (rel: string, n: number) => `Last synced ${rel} · ${n > 0 ? `${n} new` : 'up to date'}`,
      browserClosed: 'Browser closed: sync will resume when it opens',
      notLoggedIn: (p: SyncPlatformKey, browser: string | null) =>
        `Sign in to ${NAME[p]} in ${browser ?? 'your browser'}`,
      permissions: (p: SyncPlatformKey) =>
        `Allow access to ${SITE[p]} in the extension (extension button › “Allow access to sites”)`,
      blocked: (p: SyncPlatformKey) =>
        p === 'x'
          ? 'X is refusing the extension’s request: open x.com/i/bookmarks (your bookmarks are picked up there too), then “Sync Now”'
          : `${NAME[p]} is refusing the extension’s request: open ${SITE[p]} to sign in again, then “Sync Now”`,
      authRequired: (p: SyncPlatformKey, browser: string | null) =>
        p === 'instagram'
          ? `Instagram is asking for a verification: open instagram.com in ${browser ?? 'your browser'}`
          : `Sign in to ${NAME[p]} in ${browser ?? 'your browser'}`,
      rateLimited: (at: string | null) =>
        at ? `Limit reached: resuming around ${at}` : 'Limit reached: resuming later',
      budget: 'Daily quota reached: resuming tomorrow',
      apiChanged: (p: SyncPlatformKey) => `${NAME[p]} changed its site: RecoltOS needs an update`,
      network: 'Network error: trying again at the next slot',
      waiting: (p: SyncPlatformKey) => `Waiting: open ${SITE[p]} once`,
      imported: 'On in GatherOS: turn it on here to pick up where it left off',
    },
    menu: {
      open: (p: SyncPlatformKey) => `${NAME[p]} sync options`,
      now: 'Sync Now',
      resync: 'Resync Everything',
      backgroundTab: 'Open a background tab if needed',
      journal: 'View Log',
    },
    learnMore: 'Learn More',
    unofficial: 'Unofficial sync, through your browser session.',
    learnMoreText:
      'RecoltOS reads your saved posts as if you were scrolling through them, from the extension in your signed-in browser, in the background and without opening a tab. This isn’t an official API: X, Instagram or Cosmos may block it or temporarily limit your account. RecoltOS never posts, likes or deletes anything, your cookies never leave the browser, and sync only runs while your browser is open.',
    extension: {
      title: 'Browser extension',
      connected: (browsers: string) => `Connected — ${browsers}`,
      missing: 'Not detected',
      install: 'Install the Extension…',
      background: 'Sync runs in the background, with no tab open, as long as your browser is open.',
      browserClosed: 'Your browser is closed or the extension isn’t loaded: sync is paused.',
      supported: 'Firefox, Chrome, Brave, Edge and Vivaldi. Safari isn’t supported.',
      stale: (v: string, b: string) =>
        `Your extension (v${v}) is older than the one bundled with RecoltOS (v${b}): remove it, then load the RecoltOS folder again.`,
      gatheros:
        'GatherOS may still be syncing your saved posts: turn off its sync (Settings › Syncing) and remove its extension before turning on Instagram.',
      reveal: 'Reveal Folder',
      revealXpi: 'Reveal Signed File',
      repair: 'Reinstall the Connector',
      repaired: (n: number) => `Connector installed for ${n} ${s(n, 'browser', 'browsers')}`,
    },
    install: {
      title: 'Install the RecoltOS extension',
      firefox: 'Firefox',
      chromium: 'Chrome, Brave, Edge, Vivaldi',
      ffSignedTitle: 'Signed version (recommended)',
      ffSigned1: 'Reveal the signed .xpi file, then drag it into a Firefox window.',
      ffSigned2: 'Confirm the install, then pin the extension if you like.',
      ffNoSigned:
        'No signed version is available yet: run “pnpm run sign:firefox” with your Mozilla API keys (see docs/extension.md), or use temporary loading.',
      ffTempTitle: 'Temporary loading (until Firefox restarts)',
      ffTemp1: 'Copy the address about:debugging#/runtime/this-firefox and open it in Firefox.',
      ffTemp2: 'Click “Load Temporary Add-on…”.',
      ffTemp3: 'Choose the manifest.json file in the RecoltOS folder.',
      cr1: 'Copy the address chrome://extensions and open it in your browser.',
      cr2: 'Turn on Developer mode (top right).',
      cr3: 'Click “Load unpacked” and choose the RecoltOS folder.',
      copy: 'Copy Address',
      copied: 'Address copied',
      waiting: 'Waiting for the extension…',
      done: (b: string) => `Extension connected in ${b}`,
      close: 'Done',
    },
    activate: {
      title: (p: SyncPlatformKey) => `Turn on ${NAME[p]} sync?`,
      risk1: (p: SyncPlatformKey) =>
        `RecoltOS reads your ${NAME[p]} ${p === 'x' ? 'bookmarks' : 'saved posts'} with your browser session, in the background, without opening a tab.`,
      risk2:
        'This isn’t an official API: the site may block reading or temporarily limit your account.',
      risk3: 'RecoltOS never posts, likes or deletes anything; your cookies stay in the browser.',
      backgroundTab: (p: SyncPlatformKey) =>
        `If the site refuses background reading, allow RecoltOS to open a ${NAME[p]} tab in the background (closed right away)`,
      gatherosBlock:
        'GatherOS may still be syncing your Instagram saved posts. Two extensions querying Instagram double the requests and raise the risk of an account check. Turn off Settings › Syncing in GatherOS and remove its extension from your browsers.',
      done: 'Done',
      anyway: 'Turn On Anyway',
      confirm: 'Turn On',
      cancel: 'Cancel',
    },
    journal: {
      title: (p: SyncPlatformKey) => `${NAME[p]} sync log`,
      empty: 'No runs yet.',
      modes: {
        incremental: 'incremental',
        backfill: 'history',
        deep: 'full',
        passive: 'passive',
      },
      reasons: {
        schedule: 'scheduled',
        manual: 'manual',
        hint: 'bookmark',
        toggle: 'turned on',
        import: 'import',
      },
      targets: {
        background: 'background',
        tab: 'open tab',
        created_tab: 'new tab',
      },
      line: (pages: number, n: number) => `${pages} ${s(pages, 'page', 'pages')} · ${n} new`,
    },
    toast: {
      newItems: (n: number, p: SyncPlatformKey) =>
        p === 'x'
          ? `${n} new X ${s(n, 'bookmark', 'bookmarks')}`
          : `${n} new ${NAME[p]} saved ${s(n, 'post', 'posts')}`,
      recovered: (n: number) => `${n} older ${s(n, 'post', 'posts')} recovered`,
      review: 'Review',
    },
    review: {
      title: 'Recovered posts',
      description: 'The backfill found these older posts. Keep them or move them to the trash.',
      keep: 'Keep All',
      trash: 'Move All to Trash',
      trashed: (n: number) => `${n} ${s(n, 'item', 'items')} moved to the trash`,
    },
  },
}
