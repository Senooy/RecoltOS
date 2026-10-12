/**
 * Manifest MV3 de l'extension, généré PAR CIBLE depuis une seule source :
 * - `chromium` (Chrome, Brave, Edge, Vivaldi…) : `background.service_worker`, `key` (identifiant fixe),
 *   `minimum_chrome_version` 127 (`action.openPopup`) ;
 * - `firefox` : `background.scripts`, stable public Gecko ID, without `key`.
 * Pas de `webRequest`, pas de `<all_urls>` : `activeTab` après un clic, hôtes des trois plateformes.
 */
import {
  EXTENSION_KEY,
  EXTENSION_VERSION,
  GECKO_ID,
  type ExtensionTarget,
} from '../src/shared/bridge/constants'

export const PLATFORM_HOSTS = [
  'https://x.com/*',
  'https://twitter.com/*',
  'https://pbs.twimg.com/*',
  'https://video.twimg.com/*',
  'https://abs.twimg.com/*',
  'https://www.instagram.com/*',
  'https://*.cdninstagram.com/*',
  'https://*.fbcdn.net/*',
  'https://www.cosmos.so/*',
  'https://cosmos.so/*',
  'https://api.cosmos.so/*',
  'https://cdn.cosmos.so/*',
]

/** Pages où le hook et le pont de contenu s'injectent. */
export const CONTENT_MATCHES = [
  'https://x.com/*',
  'https://twitter.com/*',
  'https://www.instagram.com/*',
  'https://www.cosmos.so/*',
]

/**
 * Textes du manifest par langue (`_locales/<langue>/messages.json`, écrits par `build-ext`) :
 * le navigateur choisit selon SA langue ; anglais par défaut (`default_locale`).
 */
export const MANIFEST_LOCALES: Record<'en' | 'fr', Record<string, { message: string }>> = {
  en: {
    actionTitle: { message: 'Save to RecoltOS' },
    savePageCommand: { message: 'Save the page to RecoltOS' },
  },
  fr: {
    actionTitle: { message: 'Enregistrer dans RecoltOS' },
    savePageCommand: { message: 'Enregistrer la page dans RecoltOS' },
  },
}

export interface ManifestOptions {
  /** Hôtes supplémentaires (build de test : faux serveur local). */
  extraHosts?: string[]
}

export function buildManifest(
  target: ExtensionTarget,
  opts: ManifestOptions = {},
): Record<string, unknown> {
  const hosts = [...PLATFORM_HOSTS, ...(opts.extraHosts ?? [])]
  const matches = [...CONTENT_MATCHES, ...(opts.extraHosts ?? [])]
  const icons = {
    '16': 'icons/16.png',
    '32': 'icons/32.png',
    '48': 'icons/48.png',
    '128': 'icons/128.png',
  }
  const m: Record<string, unknown> = {
    manifest_version: 3,
    name: 'RecoltOS – Save to your visual library',
    short_name: 'RecoltOS',
    version: EXTENSION_VERSION,
    default_locale: 'en',
    description: 'Save images, videos, pages and posts to your local RecoltOS library on macOS.',
    icons,
    action: {
      default_popup: 'popup.html',
      default_title: '__MSG_actionTitle__',
      default_icon: icons,
    },
    permissions: [
      'nativeMessaging',
      'contextMenus',
      'storage',
      'scripting',
      'alarms',
      'notifications',
      'activeTab',
      'cookies',
      'declarativeNetRequestWithHostAccess',
    ],
    host_permissions: hosts,
    content_scripts: [
      {
        matches,
        js: ['content/hook.js'],
        run_at: 'document_start',
        world: 'MAIN',
        all_frames: false,
      },
      { matches, js: ['content/bridge.js'], run_at: 'document_start', all_frames: false },
    ],
    commands: {
      _execute_action: {
        suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' },
      },
      'save-page': {
        suggested_key: { default: 'Alt+Shift+S', mac: 'Alt+Shift+S' },
        description: '__MSG_savePageCommand__',
      },
    },
  }
  if (target === 'chromium') {
    m.key = EXTENSION_KEY
    m.minimum_chrome_version = '127'
    m.background = { service_worker: 'background.js' }
  } else {
    m.background = { scripts: ['background.js'] }
    m.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        strict_min_version: '142.0',
        // Mozilla includes transfers to a local native app in its disclosure model.
        data_collection_permissions: {
          required: [
            'websiteContent',
            'browsingActivity',
            'personallyIdentifyingInfo',
            'personalCommunications',
          ],
        },
      },
    }
  }
  return m
}
