/**
 * Liste blanche des événements main → renderer (`evt:<nom>`). Sans dépendance : importée par le
 * preload sandboxé. Doit égaler `EVENT_NAMES` (clés de `events`, index.ts) : vérifié par
 * `tests/unit/shared/ipc-contract.test.ts`. Tout nouvel événement est ajouté ici et dans son domaine.
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
  'menu.command',
  'nav.openItem',
  'library.switched',
] as const
