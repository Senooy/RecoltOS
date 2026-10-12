/**
 * Platform addresses. The TEST build (`build:ext --test-base http://127.0.0.1:<port>`)
 * replaces everything with a fake local server (`__RECOLTOS_TEST_BASE__`): no real call in tests.
 */
import type { BridgePlatform } from '../../../src/shared/bridge/constants'

declare const __RECOLTOS_TEST_BASE__: string

export const TEST_BASE: string | null =
  typeof __RECOLTOS_TEST_BASE__ === 'string' && __RECOLTOS_TEST_BASE__
    ? __RECOLTOS_TEST_BASE__
    : null

export interface PlatformEndpoints {
  /** Site origin (cookies, rewritten `Origin`/`Referer`). */
  origin: string
  /** Site pages (open tabs, fallback). */
  tabPatterns: string[]
  /** Domains the header rules apply to (`requestDomains`). */
  domains: string[]
  /** Host permissions needed for background sync. */
  permissions: string[]
}

const PROD: Record<BridgePlatform, PlatformEndpoints & Record<string, string | string[]>> = {
  x: {
    origin: 'https://x.com',
    home: 'https://x.com/',
    /** Public service worker: contains the web client token. */
    sw: 'https://x.com/sw.js',
    /** GraphQL gateway (also accepts persisted queries from the x-web client). */
    graphql: 'https://x.com/i/api/graphql',
    referer: 'https://x.com/i/bookmarks',
    tabPatterns: ['https://x.com/*', 'https://twitter.com/*'],
    domains: ['x.com', 'twitter.com'],
    permissions: ['https://x.com/*', 'https://abs.twimg.com/*'],
  },
  instagram: {
    origin: 'https://www.instagram.com',
    api: 'https://www.instagram.com/api/v1',
    referer: 'https://www.instagram.com/',
    tabPatterns: ['https://www.instagram.com/*'],
    domains: ['www.instagram.com'],
    permissions: ['https://www.instagram.com/*'],
  },
  cosmos: {
    origin: 'https://www.cosmos.so',
    graphql: 'https://api.cosmos.so/graphql',
    /** Access token (JWT) taken from the session's httpOnly cookie. */
    refresh: 'https://www.cosmos.so/api/refresh-token',
    referer: 'https://www.cosmos.so/',
    tabPatterns: ['https://www.cosmos.so/*', 'https://cosmos.so/*'],
    domains: ['api.cosmos.so', 'www.cosmos.so'],
    permissions: ['https://www.cosmos.so/*', 'https://api.cosmos.so/*'],
  },
}

function testEndpoints(base: string): typeof PROD {
  const host = new URL(base).hostname
  const pat = `${base}/*`
  const p = (name: string) => `${base}/${name}`
  return {
    x: {
      origin: base,
      home: `${p('x')}/`,
      sw: `${p('x')}/sw.js`,
      graphql: `${p('x')}/i/api/graphql`,
      referer: `${p('x')}/i/bookmarks`,
      tabPatterns: [pat],
      domains: [host],
      permissions: [pat],
    },
    instagram: {
      origin: base,
      api: `${p('instagram')}/api/v1`,
      referer: `${p('instagram')}/`,
      tabPatterns: [pat],
      domains: [host],
      permissions: [pat],
    },
    cosmos: {
      origin: base,
      graphql: `${p('cosmos')}/graphql`,
      refresh: `${p('cosmos')}/api/refresh-token`,
      referer: `${p('cosmos')}/`,
      tabPatterns: [pat],
      domains: [host],
      permissions: [pat],
    },
  }
}

export const ENDPOINTS = TEST_BASE ? testEndpoints(TEST_BASE) : PROD

export function endpoint(p: BridgePlatform, key: string): string {
  const v = ENDPOINTS[p][key]
  if (typeof v !== 'string') throw new Error(`adresse inconnue : ${p}.${key}`)
  return v
}

/** Platform of a page URL (x.com, instagram.com, cosmos.so). */
export function platformOfUrl(url: string | undefined): BridgePlatform | null {
  if (!url) return null
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }
  const is = (d: string) => host === d || host.endsWith(`.${d}`)
  if (is('x.com') || is('twitter.com')) return 'x'
  if (is('instagram.com')) return 'instagram'
  if (is('cosmos.so')) return 'cosmos'
  return null
}
