# RecoltOS extension privacy policy

Last updated: October 12, 2026.

## Local storage and communication

RecoltOS does not operate a server for this extension. The extension has no advertising, analytics,
telemetry, tracking pixels or developer-operated data collection service. We do not receive, sell
or share your saved content.

When you choose to save an image, video, page, link or post, the extension sends the selected content
and its source information to the RecoltOS app on your Mac through native messaging. Saving a page
can include its title, URL and a screenshot of the visible page. The app stores the result in your
local library. Saved content is not uploaded to a RecoltOS server or an unrelated third party by
the extension.

The extension also sends connection information to the local app: browser and extension versions,
a locally generated browser-profile identifier, supported-site connection status, account identifiers
or handles when available, and the number of open tabs on supported sites. This lets the app show
which browser and accounts are available. It does not transmit your complete browsing history.

Mozilla classifies these transfers to a native app as data transmission even though their destination
is your own Mac. Firefox discloses the corresponding categories during installation.

## Optional synchronization

Synchronization with X, Instagram and Cosmos is optional, unofficial and disabled by default in
RecoltOS. It runs only when you enable the relevant source in the desktop app and your browser is
open. It uses your existing browser session to read your own saved posts or bookmarks and sends
those selected results to the local app. It does not read private messages.

Requests go directly to the selected service and its media hosts. Those services receive the
requests necessary to provide their content, under their own privacy policies. The desktop app
can also download the images or videos you save from their original hosts.

Session cookies remain under the browser's control. They are used only to authenticate requests
to their own websites and are never sent to the RecoltOS app, the developer or unrelated services.
CSRF values are used only in requests to the corresponding service. A Cosmos access token and
limited request configuration can be stored in the extension's local browser storage so that
synchronization can continue across browser restarts; these credentials are not sent to the app.

## Browser storage and control

The extension uses local browser storage for connection state, language, recent collection choices,
request configuration and the Cosmos token described above. It does not use browser cloud-sync
storage. Uninstalling the extension removes its browser storage. Your desktop library remains on
your Mac until you remove its contents or delete its local data.

You can disable each synchronization source in RecoltOS at any time. Right-click saving remains
available when synchronization is disabled. The extension needs the desktop app to store content;
small saves can be queued locally while the app is closed.

The desktop app has separate optional AI features. They are off by default and require your consent;
when enabled, the AI provider you choose may receive the content you submit for analysis. This is
not an extension analytics or collection service.

## Independence and contact

RecoltOS is an independent open-source project under the MIT license. It is not affiliated with
X Corp., Meta/Instagram or Cosmos.

Questions and privacy reports can be submitted through the
[RecoltOS repository](https://github.com/Senooy/RecoltOS/issues). Do not include personal data or
credentials in a public issue.
