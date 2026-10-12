/**
 * Content hook, MAIN world, `document_start`: wraps `fetch` and `XMLHttpRequest`
 * for the watched URLs only (`WATCH`) and passes to the content bridge (ISOLATED world) the URL, the
 * method, the body, the status, the JSON response and a few USEFUL headers (templates, tokens) via
 * a tagged `window.postMessage`. Nothing else is read; the page may forge these messages: the bridge and
 * the background re-validate everything.
 */
/* eslint-disable @typescript-eslint/unbound-method -- deliberate wrapping of native methods */
;(() => {
  const w = window as Window & { __recoltosHooked?: boolean }
  if (w.__recoltosHooked) return
  w.__recoltosHooked = true
  const WATCH = [
    // X: old client (`x.com/i/api/graphql/<id>/Bookmarks`) and x-web client (Relay requests
    // persisted on `api.x.com/graphql/<id>/<name>` or `x.com/i/api/graphql/…`).
    /\/graphql\/[^/?]+\/(Bookmarks|bookmarksQuery|CreateBookmark|bookmarkButtonAddMutation|TweetDetail|TweetResultByRestId|HomeTimeline(?:Query)?|HomeLatestTimeline(?:Query)?|UserTweets)\b/,
    /\/api\/v1\/feed\/saved\/posts\//,
    /\/api\/v1\/web\/save\/\d+\/(save|unsave)\//,
    /^https:\/\/www\.instagram\.com\/(graphql\/query|api\/graphql)\/?(\?|$)/,
    /api\.cosmos\.so\/graphql/,
  ]
  const REQ_HEADERS = [
    'authorization',
    'x-client-transaction-id',
    'x-asbd-id',
    'x-ig-www-claim',
    'x-fb-friendly-name',
  ]
  const hit = (u: string) => WATCH.some((r) => r.test(u))
  const emit = (data: unknown) => window.postMessage({ __recoltos: 1, data }, location.origin)
  const pick = (get: (k: string) => string | null | undefined) =>
    Object.fromEntries(
      REQ_HEADERS.map((k) => [k, get(k)]).filter(
        (e): e is [string, string] => typeof e[1] === 'string',
      ),
    )
  const bodyStr = (b: unknown) =>
    typeof b === 'string'
      ? b.slice(0, 20_000)
      : b instanceof URLSearchParams
        ? b.toString().slice(0, 20_000)
        : null
  const parse = (t: string): unknown => {
    try {
      return JSON.parse(t.replace(/^for \(;;\);/, ''))
    } catch {
      return null
    }
  }

  const ofetch = window.fetch
  window.fetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const res = await ofetch.call(this, input, init)
    try {
      const url = input instanceof Request ? input.url : String(input)
      if (hit(url)) {
        const h = new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined),
        )
        const req = {
          url,
          method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
          headers: pick((k) => h.get(k)),
          body: bodyStr(init?.body),
        }
        const claim = res.headers.get('x-ig-set-www-claim')
        void res
          .clone()
          .text()
          .then((t) => emit({ req, status: res.status, claim, json: parse(t) }))
          .catch(() => undefined)
      }
    } catch {
      // never any effect on the page
    }
    return res
  }

  type Rec = { method: string; url: string; headers: Record<string, string> }
  const XO = XMLHttpRequest.prototype.open
  const XS = XMLHttpRequest.prototype.send
  const XH = XMLHttpRequest.prototype.setRequestHeader
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest & { __r?: Rec },
    m: string,
    u: string | URL,
    ...rest: unknown[]
  ) {
    this.__r = { method: m, url: String(u), headers: {} }
    return (XO as (...a: unknown[]) => void).call(this, m, u, ...rest)
  }
  XMLHttpRequest.prototype.setRequestHeader = function (
    this: XMLHttpRequest & { __r?: Rec },
    k: string,
    v: string,
  ) {
    const key = k.toLowerCase()
    if (this.__r && REQ_HEADERS.includes(key)) this.__r.headers[key] = v
    return XH.call(this, k, v)
  }
  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest & { __r?: Rec },
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const r = this.__r
    if (r && hit(r.url)) {
      this.addEventListener('load', () => {
        try {
          const json =
            this.responseType === 'json' ? (this.response as unknown) : parse(this.responseText)
          emit({
            req: { ...r, body: bodyStr(body) },
            status: this.status,
            claim: this.getResponseHeader('x-ig-set-www-claim'),
            json,
          })
        } catch {
          // same
        }
      })
    }
    return XS.call(this, body as XMLHttpRequestBodyInit | null | undefined)
  }
})()
