/**
 * Adresses des plateformes. Le build de TEST (`build:ext --test-base http://127.0.0.1:<port>`)
 * remplace tout par un faux serveur local (`__RECOLTOS_TEST_BASE__`) : aucun appel réel en test.
 */
import type { BridgePlatform } from '../../../src/shared/bridge/constants'

declare const __RECOLTOS_TEST_BASE__: string

export const TEST_BASE: string | null =
  typeof __RECOLTOS_TEST_BASE__ === 'string' && __RECOLTOS_TEST_BASE__
    ? __RECOLTOS_TEST_BASE__
    : null

export interface PlatformEndpoints {
  /** Origine du site (cookies, `Origin`/`Referer` réécrits). */
  origin: string
  /** Pages du site (onglets ouverts, repli). */
  tabPatterns: string[]
  /** Domaines à qui s'appliquent les règles d'en-têtes (`requestDomains`). */
  domains: string[]
  /** Autorisations d'hôte nécessaires à la sync en arrière-plan. */
  permissions: string[]
}

const PROD: Record<BridgePlatform, PlatformEndpoints & Record<string, string | string[]>> = {
  x: {
    origin: 'https://x.com',
    home: 'https://x.com/',
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

/** Plateforme d'une URL de page (x.com, instagram.com, cosmos.so). */
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
