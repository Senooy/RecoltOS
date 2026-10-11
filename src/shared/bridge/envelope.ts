/**
 * Enveloppe des messages `{ v: 1, id, re?, type, ts, payload }` (SYNC §6.1).
 * Stub typé créé par WP-00, possédé ensuite par WP-51.
 */
import { z } from 'zod'
import { BRIDGE_ERROR_CODES, BRIDGE_PLATFORMS } from './constants'

export const Platform = z.enum(BRIDGE_PLATFORMS)
export const Trigger = z.enum(['schedule', 'hint', 'manual', 'toggle', 'import'])

/** Types de messages connus (SYNC §6.1). */
export const MESSAGE_TYPES = [
  'host.hello',
  'hello',
  'hello.ack',
  'save.create',
  'save.ack',
  'sync.page',
  'sync.run',
  'sync.ack',
  'sync.hint',
  'sync.request',
  'sync.finished',
  'capture.passive',
  'item.refresh',
  'item.data',
  'media.fetch',
  'media.chunk',
  'author.seen',
  'authors.wanted',
  'ext.stale',
  'collections.list',
  'collections.list.result',
  'collections.changed',
  'collection.create',
  'ping',
  'pong',
  'error',
] as const
export type MessageType = (typeof MESSAGE_TYPES)[number]

export const Envelope = z.object({
  v: z.literal(1),
  id: z.uuid(),
  re: z.uuid().optional(),
  type: z.string().max(64),
  ts: z.number().int().optional(),
  payload: z.unknown(),
})
export type Envelope = z.output<typeof Envelope>

export const BridgeErrorPayload = z.object({
  code: z.enum(BRIDGE_ERROR_CODES),
  message: z.string().optional(),
})
