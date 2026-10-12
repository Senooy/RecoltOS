/**
 * Requêtes de sync depuis l'ARRIÈRE-PLAN : cookies de session envoyés par le navigateur
 * (`credentials: 'include'` + autorisations d'hôte), délai de 30 s, en-têtes de réponse filtrés
 * (`x-rate-limit-*`, `content-type` : jamais d'en-tête d'authentification vers l'app). Repli : la même
 * requête exécutée dans un onglet de la plateforme (`scripting.executeScript`, monde ISOLATED).
 */
import { api } from '../../lib/api'

export interface FetchResult {
  status: number
  headers: Record<string, string>
  json: unknown
  /** Corps texte si la réponse n'est pas du JSON (HTML, script). */
  text: string | null
}

export type FetchFn = (url: string, init: RequestInit) => Promise<FetchResult>

/** Exécutée telle quelle dans le script d'arrière-plan OU sérialisée dans un onglet. */
export async function pageFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{
  status: number
  headers: Record<string, string>
  json: unknown
  text: string | null
}> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { credentials: 'include', ...init, signal: ctl.signal })
    const headers: Record<string, string> = {}
    r.headers.forEach((v, k) => {
      if (k.startsWith('x-rate-limit') || k === 'content-type' || k === 'x-ig-set-www-claim') {
        headers[k] = v
      }
    })
    const body = await r.text()
    let json: unknown = null
    let text: string | null = null
    try {
      json = JSON.parse(body.replace(/^for \(;;\);/, ''))
    } catch {
      text = body
    }
    return { status: r.status, headers, json, text }
  } catch (e) {
    return {
      status: 0,
      headers: {},
      json: null,
      text: (e as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network',
    }
  } finally {
    clearTimeout(timer)
  }
}

export const TIMEOUT_MS = 30_000

/** Arrière-plan (défaut). */
export const backgroundFetch: FetchFn = (url, init) => pageFetch(url, init, TIMEOUT_MS)

/** Repli dans un onglet existant ou créé (jamais par défaut). */
export function tabFetch(tabId: number): FetchFn {
  return async (url, init) => {
    const [res] = await api().scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: pageFetch,
      args: [url, init as Record<string, unknown>, TIMEOUT_MS],
    })
    return res?.result ?? { status: 0, headers: {}, json: null, text: 'network' }
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Délai aléatoire dans [min, max]. */
export const jitter = (min: number, max: number) => min + Math.random() * (max - min)
