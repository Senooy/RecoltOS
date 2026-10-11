/**
 * Identifiants (SYNC §1.6 n°4, ERRATA §G.2) : cookies lus À LA DEMANDE par l'API `cookies`, jamais
 * stockés ni envoyés à l'app (seuls des identifiants de compte non secrets le sont). Gabarits et
 * constantes publiques dans `storage.local` ; jetons capturés (Cosmos) dans `storage.local` aussi,
 * pour que la sync en arrière-plan survive au redémarrage du navigateur.
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

/** Tous les cookies d'une plateforme (noms seulement servent aux heuristiques). */
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
  const got = await api().storage.local.get(key)
  return got[key] as T | undefined
}

export async function setLocal(key: string, value: unknown): Promise<void> {
  await api().storage.local.set({ [key]: value })
}

export async function removeLocal(key: string): Promise<void> {
  await api().storage.local.remove(key)
}

/** Jeton Cosmos capturé lors d'une visite (hook), ou cookie au format JWT de cosmos.so. */
export async function cosmosToken(): Promise<string | null> {
  const captured = await getLocal<string>('cosmos.token')
  if (captured) return captured
  try {
    const all = await api().cookies.getAll({ url: ENDPOINTS.cosmos.origin })
    const jwt = all.find((c) => /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(c.value))
    return jwt?.value ?? null
  } catch {
    return null
  }
}
