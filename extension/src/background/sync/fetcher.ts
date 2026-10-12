/**
 * Sync requests from the BACKGROUND: session cookies sent by the browser
 * (`credentials: 'include'` + host permissions), 30 s timeout, response headers filtered
 * (`x-rate-limit-*`, `content-type`: never an auth header sent to the app). Fallback: the same
 * request run in a tab of the platform (`scripting.executeScript`, ISOLATED world).
 */
import { api } from '../../lib/api'

export interface FetchResult {
  status: number
  headers: Record<string, string>
  json: unknown
  /** Text body if the response is not JSON (HTML, script). */
  text: string | null
}

export type FetchFn = (url: string, init: RequestInit) => Promise<FetchResult>

/** Executed as-is in the background script OR serialized into a tab. */
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

/** Background (default). */
export const backgroundFetch: FetchFn = (url, init) => pageFetch(url, init, TIMEOUT_MS)

/** Fallback in an existing or newly created tab (never by default). */
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

/** Random delay within [min, max]. */
export const jitter = (min: number, max: number) => min + Math.random() * (max - min)
