/**
 * Constantes du protocole extension ↔ app (SYNC §6.1, PLAN §1.18, ERRATA §G.2).
 * Possédé par WP-51 (ERRATA §F). Aucun import : partagé par l'app, l'hôte natif et l'extension.
 */

export const BRIDGE_PROTOCOL_VERSION = 1 as const
/**
 * Version de l'extension livrée avec l'app (source unique : le build écrit `manifest.version`). À
 * augmenter à chaque changement du code de l'extension : l'app ne recopie l'extension dans
 * `<userData>/extension/` que si la version (ou le manifest) change, et demande alors à une extension
 * plus ancienne connectée de se recharger. 1.0.1 : sync X x-web et Cosmos (ERRATA §G.3).
 * 1.0.2 : nouvelles icônes (logo « graine qui germe »).
 */
export const EXTENSION_VERSION = '1.0.2'
/** Nom de l'hôte native messaging (build livré) et de dev (`RECOLTOS_INSTALL_DEV_HOST=1`). */
export const NATIVE_HOST_NAME = 'com.recoltos.host'
export const NATIVE_HOST_NAME_DEV = 'com.recoltos.host.dev'
/**
 * Clé publique de l'extension Chromium (champ `key` du manifest, `scripts/gen-extension-key.mjs`) :
 * fixe l'identifiant ci-dessous. La clé privée n'est pas conservée (extension non empaquetée).
 */
export const EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoPR+P/JDXAT6K3gMksvYlBcDsoJrSYys8Z9UooA6Sth8QuISIJHT2dLFWYxmtEiF7VpRwcrNGsco9fDXWcYNiiC/fcxTFNzB2QFQwupRZfmkjRRsxxTMkVhgKZLtDeUaAoOZdtiWtybpqqAkmcgNAaAtc9zD+/QsFjHgdRkznDiYsCyjDwMeYBX1t+9RiW5PcVxQdq/OBOoDbB/fzXDGdpiaPLFkDno9WocpX62Q/YPzIz6VgkEqUnAWGYmwuWtKANVBoRhMTUaEhcfa/S6YPlWghgcdfg4uZumE4KgscTvRuUkRPbSU4miH8wF+M/RwoAvdBT3IDkqJF1/UWz8r8wIDAQAB'
/** Identifiant Chromium : 32 lettres a–p dérivées du SHA-256 de `EXTENSION_KEY`. */
export const EXTENSION_ID = 'kkcpbglfgmkcjndibkbpjdiakanmbdhi'
/** Origine appelante passée par Chrome à l'hôte (`allowed_origins`). */
export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}/`
/** Identifiant Firefox (`browser_specific_settings.gecko.id`, `allowed_extensions`). */
export const GECKO_ID = 'recoltos@local'
/** Socket : `os.tmpdir()/recolt-<sha1(userData)[0:10]>.sock`, 0600, < 104 octets (`sun_path`). */
export const SOCKET_PREFIX = 'recolt-'
export const SOCKET_PATH_MAX_BYTES = 103
/** app → ext : chaque message < 900 Ko, sans découpage (garanti par `BridgeServer.send`). */
export const MAX_APP_TO_EXT_BYTES = 900_000
/** hôte → ext : au-delà, le navigateur ferme le port (assertion dans l'hôte). */
export const MAX_TO_EXT_BYTES = 1024 * 1024
/** ext → hôte : limite du navigateur. */
export const MAX_FROM_EXT_BYTES = 64 * 1024 * 1024
/** Binaire inline maximum dans `save.create` ; au-delà, `upload` + `media.chunk`. */
export const MAX_INLINE_MEDIA_BYTES = 8 * 1024 * 1024
export const MAX_INLINE_BASE64_CHARS = 11_184_812
/** Taille d'un `media.chunk` (binaire, avant base64). */
export const CHUNK_BYTES = 8 * 1024 * 1024
/** Taille maximale d'un upload découpé (200 Mio). */
export const MAX_UPLOAD_BYTES = 209_715_200
export const MAX_SYNC_PAGES = 50
export const MAX_WANTED_AUTHORS = 500
/** Intervalle du `ping` de l'hôte (garde le service worker éveillé). */
export const HOST_PING_MS = 20_000

export const BRIDGE_ERROR_CODES = [
  'APP_NOT_RUNNING',
  'PROTOCOL_MISMATCH',
  'MESSAGE_TOO_LARGE',
  'VALIDATION',
  'UNSUPPORTED',
  'INTERNAL',
] as const
export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[number]

export const BRIDGE_PLATFORMS = ['x', 'instagram', 'cosmos'] as const
export type BridgePlatform = (typeof BRIDGE_PLATFORMS)[number]

/** Cibles de build de l'extension (ERRATA §G.2 n°1). */
export const EXTENSION_TARGETS = ['chromium', 'firefox'] as const
export type ExtensionTarget = (typeof EXTENSION_TARGETS)[number]
