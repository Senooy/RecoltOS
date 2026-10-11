/**
 * Garde de `recolt://` sur les sessions hors écran (WP-05).
 *
 * Les partitions hors écran (parc recyclé de `windows/offscreen.ts`) servent à la fois aux routes
 * internes (`offscreen.html?render=tweet-card|space-stage`, qui ont besoin de `recolt://`) et à la
 * capture de pages http(s) distantes, qui ne doivent JAMAIS lire la bibliothèque : le schéma est
 * `corsEnabled` + `supportFetchAPI` et répond `ACAO: *`, donc une page distante pourrait sonder
 * des chemins devinables (avatars `avatars/<plateforme>/<sha1(handle)[0:16]>.jpg`) par `fetch`
 * ou `<img>` (onload/onerror, `naturalWidth`).
 *
 * `Origin` / `Referer` ne conviennent pas (une page maîtrise sa `referrer-policy`, et un `<img>`
 * sans `crossorigin` n'envoie pas `Origin`). On se fie à l'URL de la page de premier niveau de la
 * fenêtre qui utilise la session : une partition n'héberge qu'une fenêtre à la fois, et la page
 * distante ne peut pas devenir `offscreen.html` (`will-navigate` bloqué, redirections limitées à
 * http(s) par `isAllowedRedirect`). Sans fenêtre identifiable, on refuse (fail closed).
 */

/** `true` si `url` est la page interne `offscreen.html` (fichier packagé ou serveur Vite de dev). */
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
  /** URL de premier niveau de chaque fenêtre vivante qui utilise `ses`. */
  pageUrlsOf(ses: S): string[]
  rendererUrl: string | null
  onDenied?(reason: string, url: string): void
}

/**
 * Enveloppe `inner` : la requête n'est servie que si toutes les pages de la session sont la page
 * interne `offscreen.html`. Aucune page, ou une page distante → 403.
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
      deps.onDenied?.('page hors écran non interne', req.url)
      return Promise.resolve(new Response(null, { status: 403 }))
    }
    return inner(req)
  }
}
