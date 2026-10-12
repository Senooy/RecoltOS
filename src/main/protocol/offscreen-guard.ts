/**
 * Guard for `recolt://` on off-screen sessions.
 *
 * Off-screen partitions (recycled pool from `windows/offscreen.ts`) serve both the internal
 * routes (`offscreen.html?render=tweet-card|space-stage`, which need `recolt://`) and the capture
 * of remote http(s) pages, which must NEVER read the library: the scheme is `corsEnabled` +
 * `supportFetchAPI` and answers `ACAO: *`, so a remote page could probe guessable paths (avatars
 * `avatars/<plateforme>/<sha1(handle)[0:16]>.jpg`) via `fetch` or `<img>` (onload/onerror,
 * `naturalWidth`).
 *
 * `Origin` / `Referer` are not suitable (a page controls its `referrer-policy`, and an `<img>`
 * without `crossorigin` does not send `Origin`). We rely on the top-level page URL of the window
 * that uses the session: a partition hosts only one window at a time, and the remote page cannot
 * become `offscreen.html` (`will-navigate` blocked, redirects limited to http(s) by
 * `isAllowedRedirect`). Without an identifiable window, we refuse (fail closed).
 */

/** `true` if `url` is the internal page `offscreen.html` (packaged file or Vite dev server). */
export function isInternalOffscreenUrl(url: string, rendererUrl: string | null): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol === 'file:') {
    return decodeURIComponent(u.pathname).endsWith('/renderer/offscreen.html')
  }
  if ((u.protocol === 'http:' || u.protocol === 'https:') && rendererUrl) {
    try {
      return u.origin === new URL(rendererUrl).origin && u.pathname === '/offscreen.html'
    } catch {
      return false
    }
  }
  return false
}

export interface OffscreenGuardDeps<S> {
  /** Top-level URL of each live window that uses `ses`. */
  pageUrlsOf(ses: S): string[]
  rendererUrl: string | null
  onDenied?(reason: string, url: string): void
}

/**
 * Wraps `inner`: the request is only served if all pages of the session are the internal
 * `offscreen.html` page. No page, or a remote page → 403.
 */
export function guardOffscreenHandler<S>(
  ses: S,
  inner: (req: Request) => Promise<Response>,
  deps: OffscreenGuardDeps<S>,
): (req: Request) => Promise<Response> {
  return (req) => {
    const pages = deps.pageUrlsOf(ses)
    const trusted =
      pages.length > 0 && pages.every((u) => isInternalOffscreenUrl(u, deps.rendererUrl))
    if (!trusted) {
      deps.onDenied?.('non-internal offscreen page', req.url)
      return Promise.resolve(new Response(null, { status: 403 }))
    }
    return inner(req)
  }
}
