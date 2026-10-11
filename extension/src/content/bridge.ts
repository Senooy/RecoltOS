/**
 * Pont de contenu, monde ISOLATED (SYNC §2.7, §2.4) : reçoit les événements du hook (vérifie la
 * source, l'origine et le marqueur), les classe (`classify.ts`) et les relaie à l'arrière-plan ;
 * garde un petit cache des posts X vus (bouton « Enregistrer dans RecoltOS » des publications).
 */
import { api } from '../lib/api'
import { classify, type HookEvent } from '../lib/classify'
import { injectButtons, type PostRef } from '../lib/inject'

const tweetCache = new Map<string, unknown>()
const MAX_CACHE = 500

function remember(id: string, raw: unknown): void {
  tweetCache.delete(id)
  tweetCache.set(id, raw)
  if (tweetCache.size > MAX_CACHE) tweetCache.delete(tweetCache.keys().next().value as string)
}

/** Parcourt une réponse GraphQL X et met en cache chaque `tweet_results.result` par `rest_id`. */
function cacheTweets(json: unknown, depth = 0): void {
  if (!json || typeof json !== 'object' || depth > 30) return
  if (Array.isArray(json)) {
    for (const v of json) cacheTweets(v, depth + 1)
    return
  }
  const o = json as Record<string, unknown>
  const tr = o.tweet_results as
    { result?: { rest_id?: unknown; tweet?: { rest_id?: unknown } } } | undefined
  const id = tr?.result?.rest_id ?? tr?.result?.tweet?.rest_id
  if (typeof id === 'string') remember(id, tr?.result)
  for (const v of Object.values(o)) if (v && typeof v === 'object') cacheTweets(v, depth + 1)
}

window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.source !== window || ev.origin !== location.origin) return
  const d = ev.data as { __recoltos?: number; data?: HookEvent } | null
  if (d?.__recoltos !== 1 || !d.data?.req) return
  const e = d.data
  if (location.hostname.endsWith('x.com')) cacheTweets(e.json)
  for (const m of classify(e)) {
    void api()
      .runtime.sendMessage(m)
      .catch(() => undefined)
  }
})

function savePost(ref: PostRef): Promise<{ status?: string } | undefined> {
  const raw = ref.platform === 'x' ? tweetCache.get(ref.externalId) : undefined
  return api().runtime.sendMessage({
    type: 'content:save-post',
    payload: {
      kind: 'post',
      pageUrl: ref.url,
      post: {
        platform: ref.platform,
        externalId: ref.externalId,
        ...(raw ? { raw } : {}),
        dom: ref.dom,
        partial: !raw,
      },
    },
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => injectButtons(document, savePost), {
    once: true,
  })
} else {
  injectButtons(document, savePost)
}
