/**
 * Allowlist of main → renderer events (`evt:<name>`). No dependency: imported by the
 * sandboxed preload. Must equal `EVENT_NAMES` (keys of `events`, index.ts): checked by
 * `tests/unit/shared/ipc-contract.test.ts`. Any new event is added here and in its domain.
 */
export const EVENT_NAME_LIST = [
  'ai.queue',
  'ai.result',
  'capture.done',
  'capture.permissionRequired',
  'collections.changed',
  'export.progress',
  'import.progress',
  'ingest.progress',
  'items.changed',
  'jobs.progress',
  'prefs.changed',
  'spaces.changed',
  'spaces.exportProgress',
  'sync.status',
  'updates.status',
  'menu.command',
  'nav.openItem',
  'library.switched',
] as const
