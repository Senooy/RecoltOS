/** Identifiers. */

/** New UUID v4 (`crypto.randomUUID()`, available in Node 22+, Electron and Chromium). */
export function newUuid(): string {
  return globalThis.crypto.randomUUID()
}

/** Sharding folder of a file: first 2 characters of the uuid (`items/<ab>/<uuid>.<ext>`). */
export function shard(uuid: string): string {
  return uuid.slice(0, 2).toLowerCase()
}

/** New library identifier: `l` + `Date.now().toString(36)`. */
export function newLibraryId(now: number = Date.now()): string {
  return `l${now.toString(36)}`
}
