# RecoltOS extension store listing

## Name

RecoltOS – Save to your visual library

## Short description

Save images, videos, pages and posts to your local RecoltOS library on macOS.

## Description

Save visual references to your own library on your Mac. Right-click an image, video, link or page
and choose “Save to RecoltOS”, or use the extension popup to choose a collection and add a note.

This extension requires the RecoltOS desktop app for macOS on an Apple Silicon Mac. Download it at
https://github.com/Senooy/RecoltOS/releases/latest and open the app once to install its native
messaging connector. The extension communicates with that local app; RecoltOS does not operate a
server for your library.

Optional synchronization can import your own X bookmarks, Instagram saved posts and Cosmos saves
using your existing browser session. Synchronization is unofficial, disabled by default and runs
only when you enable it in RecoltOS and keep your browser open. You can disable each source at any
time and continue to save items by right-clicking. Session cookies are never sent to the desktop
app or to the developer.

RecoltOS is an independent open-source project under the MIT license. It is not affiliated with
X Corp., Meta/Instagram or Cosmos.

Repository: https://github.com/Senooy/RecoltOS

Privacy policy: https://github.com/Senooy/RecoltOS/blob/main/PRIVACY.md

## Category and language

Category: Productivity. Language: English. No translated store listings.

## Single purpose

Save and organize user-selected visual references in the local RecoltOS desktop library. Optional
saved-post synchronization is another way to import references into that same library.

## Permission justifications

- `nativeMessaging`: Send selected content and connection status to the RecoltOS app on the user's
  Mac, and receive collection choices and save results. No remote RecoltOS server is involved.
- `contextMenus`: Add “Save to RecoltOS” and collection choices to the image, video, link and page
  context menus.
- `storage`: Keep local connection state, language, recent collection choices, request configuration
  and the Cosmos access token needed for optional synchronization. Browser cloud-sync storage is
  not used.
- `scripting`: Read the title, preview or media of the page the user chooses to save and show save
  feedback. On supported sites, extract selected post data and provide optional sync fallback.
- `activeTab`: Access the current page after the user clicks the extension, uses its shortcut or
  selects its context-menu command; capture the visible page when saving a page.
- `alarms`: Maintain the native connector and resume app-requested optional synchronization while
  the browser is open.
- `cookies`: Check session availability and use the relevant site's CSRF values for optional
  saved-post synchronization. Cookies are never passed to the desktop app or the developer.
- `notifications`: Display a save error when feedback cannot be shown inside the current page.
- `declarativeNetRequestWithHostAccess`: Set the appropriate Origin and Referer for the supported
  services' authenticated requests during optional synchronization. It is not used to intercept
  unrelated browsing traffic or block ads.

Host access is limited to X and its legacy domain and media hosts (`x.com`, `twitter.com`,
`pbs.twimg.com`, `video.twimg.com`, `abs.twimg.com`), Instagram and its media hosts
(`www.instagram.com`, `*.cdninstagram.com`, `*.fbcdn.net`), and Cosmos and its API/media hosts
(`cosmos.so`, `www.cosmos.so`, `api.cosmos.so`, `cdn.cosmos.so`). These permissions support saving
and the optional synchronization of the user's own saved items. There is no all-sites host
permission; saving an unrelated page uses the user-initiated `activeTab` grant.

## Privacy practices

Selected website content, source URLs, social posts and connection metadata are processed for the
extension's stated purpose and transmitted only to the local native app. Account identifiers or
handles are used to show the connected source account. Browser/extension versions and a local
profile identifier support the connector. There is no sale of data, advertising, unrelated data
use, analytics or developer-operated collection server.

Optional synchronization makes authenticated requests directly to the selected services. The
extension does not send cookies or access tokens to the native app. It does not read private
messages, collect location or payment details, or record complete browsing history.

The use of information received from Google APIs adheres to the Chrome Web Store User Data Policy,
including the Limited Use requirements. User data is used only to provide or improve the single
purpose described above, is not sold to third parties, and is not used for creditworthiness or
lending decisions.

## Reviewer testing instructions

The extension requires the RecoltOS macOS app:
https://github.com/Senooy/RecoltOS/releases/latest

No website account is needed to test saving. Install the app on an Apple Silicon Mac, open it once,
then install the extension. Right-click an image on an ordinary web page and choose “Save to
RecoltOS”. The image appears in the local library. Settings → Synchronisation shows the connected
browser. The popup can save the current page and choose a collection.

Synchronization is optional and disabled by default. It is not necessary for the above test. To
test it, sign in to a supported service in the browser and explicitly enable that source in the
app. The extension reads that account's saved items; it does not scrape other users' accounts.

The source archive includes `SOURCE_BUILD.md` with the exact build environment and commands. All
extension JavaScript is bundled by esbuild from the provided source; there is no remotely hosted
executable code, obfuscated code or evaluation of downloaded scripts. Public X scripts are read as
text only to locate request configuration; they are not executed by the extension.
