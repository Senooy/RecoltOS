/**
 * Constantes du protocole extension ↔ app (SYNC §6.1, PLAN §1.18).
 * Stub typé créé par WP-00, possédé ensuite par WP-51 (ERRATA §F).
 */

export const BRIDGE_PROTOCOL_VERSION = 1 as const
/** Nom de l'hôte native messaging (build livré) et de dev (`RECOLTOS_INSTALL_DEV_HOST=1`). */
export const NATIVE_HOST_NAME = 'com.recoltos.host'
export const NATIVE_HOST_NAME_DEV = 'com.recoltos.host.dev'
/** Socket : `os.tmpdir()/recolt-<sha1(userData)[0:10]>.sock`, 0600, < 104 octets (`sun_path`). */
export const SOCKET_PREFIX = 'recolt-'
export const SOCKET_PATH_MAX_BYTES = 103
/** app → ext : chaque message < 900 Ko, sans découpage. */
export const MAX_APP_TO_EXT_BYTES = 900_000
/** Binaire inline maximum dans `save.create` ; au-delà, `upload` + `media.chunk`. */
export const MAX_INLINE_MEDIA_BYTES = 8 * 1024 * 1024
export const MAX_INLINE_BASE64_CHARS = 11_184_812
/** Taille maximale d'un upload découpé (200 Mio). */
export const MAX_UPLOAD_BYTES = 209_715_200
export const MAX_SYNC_PAGES = 50
export const MAX_WANTED_AUTHORS = 500

export const BRIDGE_ERROR_CODES = [
  'APP_NOT_RUNNING',
  'PROTOCOL_MISMATCH',
  'MESSAGE_TOO_LARGE',
  'VALIDATION',
] as const
export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[number]

export const BRIDGE_PLATFORMS = ['x', 'instagram', 'cosmos'] as const
export type BridgePlatform = (typeof BRIDGE_PLATFORMS)[number]
