/**
 * Extension state reported to the app (`hello`, `ext.status`): session per platform (presence of a
 * session cookie, never its value), host permissions (Firefox MV3: optional), browser.
 */
import {
  BRIDGE_PLATFORMS,
  BRIDGE_PROTOCOL_VERSION,
  type BridgePlatform,
} from '../../../src/shared/bridge/constants'
import type { PayloadOf, PlatformState, PlatformsState } from '../../../src/shared/bridge/messages'
import { api, TARGET } from '../lib/api'
import { ENDPOINTS } from '../lib/endpoints'
import { accountFromTwid, cookieNames, getLocal, readCookie, setLocal } from './creds'
import { cosmosTokenUsable, storedCosmosToken } from './sync/platforms'

export async function hasPermission(p: BridgePlatform): Promise<boolean> {
  try {
    return await api().permissions.contains({ origins: ENDPOINTS[p].permissions })
  } catch {
    return false
  }
}

export async function platformState(p: BridgePlatform): Promise<PlatformState> {
  const permission = await hasPermission(p)
  if (p === 'x') {
    const [auth, twid] = await Promise.all([readCookie('x', 'auth_token'), readCookie('x', 'twid')])
    return { loggedIn: !!auth, accountId: accountFromTwid(twid), permission }
  }
  if (p === 'instagram') {
    const [sid, uid] = await Promise.all([
      readCookie('instagram', 'sessionid'),
      readCookie('instagram', 'ds_user_id'),
    ])
    return { loggedIn: !!sid, accountId: sid ? uid : null, permission }
  }
  // Cosmos: access token still valid, otherwise a site session cookie (the refresh
  // cookie is httpOnly: only its name is read, never its value).
  const usable = cosmosTokenUsable(await storedCosmosToken())
  const names = usable ? [] : await cookieNames('cosmos')
  const me = await getLocal<{ id: string | number; username?: string }>('cosmos.me')
  return {
    loggedIn: usable || names.some((n) => /session|token|auth|refresh|jwt|csms_account/i.test(n)),
    accountId: me?.id !== undefined ? String(me.id) : null,
    handle: me?.username ?? null,
    permission,
  }
}

export async function platformsState(): Promise<PlatformsState> {
  const [x, instagram, cosmos] = await Promise.all(BRIDGE_PLATFORMS.map((p) => platformState(p)))
  return { x: x!, instagram: instagram!, cosmos: cosmos! }
}

async function profileId(): Promise<string> {
  let id = await getLocal<string>('profileId')
  if (!id) {
    id = globalThis.crypto.randomUUID()
    await setLocal('profileId', id)
  }
  return id
}

async function browserInfo(): Promise<{ name: string; version: string }> {
  const rt = api().runtime as typeof chrome.runtime & {
    getBrowserInfo?: () => Promise<{ name: string; version: string }>
  }
  if (rt.getBrowserInfo) {
    try {
      const b = await rt.getBrowserInfo()
      return { name: b.name, version: b.version }
    } catch {
      // fallback below
    }
  }
  const nav = globalThis.navigator as Navigator & {
    userAgentData?: { brands?: { brand: string; version: string }[] }
  }
  const brands = nav.userAgentData?.brands ?? []
  const pick =
    brands.find((b) => /Brave|Edge|Vivaldi|Opera|Google Chrome/.test(b.brand)) ??
    brands.find((b) => /Chromium/.test(b.brand))
  return {
    name: pick?.brand ?? (TARGET === 'firefox' ? 'Firefox' : 'Chromium'),
    version: pick?.version ?? '',
  }
}

async function openTabs(p: BridgePlatform): Promise<number> {
  try {
    return (await api().tabs.query({ url: ENDPOINTS[p].tabPatterns })).length
  } catch {
    return 0
  }
}

export async function helloPayload(): Promise<PayloadOf<'hello'>> {
  const [platforms, pid, browser, x, instagram, cosmos] = await Promise.all([
    platformsState(),
    profileId(),
    browserInfo(),
    openTabs('x'),
    openTabs('instagram'),
    openTabs('cosmos'),
  ])
  return {
    extVersion: api().runtime.getManifest().version,
    protocol: BRIDGE_PROTOCOL_VERSION,
    target: TARGET,
    browser,
    profileId: pid,
    platforms,
    openTabs: { x, instagram, cosmos },
  }
}

/** Cookies that change the session state (trigger `ext.status`). */
export const SESSION_COOKIES = new Set(['auth_token', 'twid', 'sessionid', 'ds_user_id'])
