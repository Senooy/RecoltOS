/** Identifiants (ARCHI §2.1). */

/** Nouvel UUID v4 (`crypto.randomUUID()`, disponible dans Node 22+, Electron et Chromium). */
export function newUuid(): string {
  return globalThis.crypto.randomUUID()
}

/** Dossier de répartition d'un fichier : 2 premiers caractères de l'uuid (`items/<ab>/<uuid>.<ext>`). */
export function shard(uuid: string): string {
  return uuid.slice(0, 2).toLowerCase()
}

/** Identifiant de nouvelle bibliothèque : `l` + `Date.now().toString(36)` (ARCHI §3.2). */
export function newLibraryId(now: number = Date.now()): string {
  return `l${now.toString(36)}`
}
