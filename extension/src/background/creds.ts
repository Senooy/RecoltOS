/**
 * Credentials: cookies are read ON DEMAND through the `cookies` API, never
 * stored or sent to the app (only non-secret account identifiers are). Templates and
 * public constants live in `storage.local`; the Cosmos access token (obtained via
 * `/api/refresh-token`, see `sync/platforms.ts`) is also kept in `storage.local`, so that
 * background sync survives a browser restart.
 */
import type { BridgePlatform } from '../../../src/shared/bridge/constants'
import { api } from '../lib/api'
import { ENDPOINTS } from '../lib/endpoints'

export async function readCookie(p: BridgePlatform, name: string): Promise<string | null> {
  try {
    const c = await api().cookies.get({ url: ENDPOINTS[p].origin, name })
    return c?.value ?? null
  } catch {
    return null
  }
}

/** All cookies of a platform (only the names are used by the heuristics). */
export async function cookieNames(p: BridgePlatform): Promise<string[]> {
  try {
    const all = await api().cookies.getAll({ url: ENDPOINTS[p].origin })
    return all.map((c) => c.name)
  } catch {
    return []
  }
}

/** `twid` = `u%3D<id>` → `<id>`. */
export function accountFromTwid(twid: string | null): string | null {
  if (!twid) return null
  const m = /u(?:%3D|=)(\d+)/i.exec(decodeURIComponent(twid))
  return m?.[1] ?? null
}

export async function getLocal<T>(key: string): Promise<T | undefined> {
  const got: unknown = await api().storage.local.get(key)
  return (got as Record<string, unknown> | undefined)?.[key] as T | undefined
}

/** Typed read of `storage.session` (one or more keys). */
export async function sessionGet<T extends object>(keys: string | string[]): Promise<Partial<T>> {
  const got: unknown = await api().storage.session.get(keys)
  return got ?? {}
}

export async function setLocal(key: string, value: unknown): Promise<void> {
  await api().storage.local.set({ [key]: value })
}

export async function removeLocal(key: string): Promise<void> {
  await api().storage.local.remove(key)
}
