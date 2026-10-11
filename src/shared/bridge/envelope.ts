/**
 * Enveloppe des messages `{ v: 1, id, re?, type, ts, payload }` (SYNC §6.1). Possédé par WP-51.
 * Utilisé par l'app, l'hôte natif (bundle) et l'extension : aucune dépendance hors zod.
 */
import { z } from 'zod'
import { BRIDGE_ERROR_CODES, BRIDGE_PLATFORMS, BRIDGE_PROTOCOL_VERSION } from './constants'

export const Platform = z.enum(BRIDGE_PLATFORMS)
export const Trigger = z.enum(['schedule', 'hint', 'manual', 'toggle', 'import'])
export type Trigger = z.output<typeof Trigger>

/** Types de messages connus (SYNC §6.1, + `ext.status`, `app.status`, `host.hello`). */
export const MESSAGE_TYPES = [
  'host.hello',
  'app.status',
  'hello',
  'hello.ack',
  'ext.status',
  'save.create',
  'save.ack',
  'sync.page',
  'sync.run',
  'sync.ack',
  'sync.hint',
  'sync.request',
  'sync.finished',
  'sync.cancel',
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const Envelope = z.object({
  v: z.literal(BRIDGE_PROTOCOL_VERSION),
  id: z.string().regex(UUID_RE, 'uuid attendu'),
  re: z.string().regex(UUID_RE, 'uuid attendu').optional(),
  type: z.string().max(64),
  ts: z.number().int().optional(),
  payload: z.unknown(),
})
export type Envelope = z.output<typeof Envelope>

export const BridgeErrorPayload = z.object({
  code: z.enum(BRIDGE_ERROR_CODES),
  message: z.string().max(2000).optional(),
  /** `PROTOCOL_MISMATCH` : version de l'app. */
  appProtocol: z.number().int().optional(),
  /** `MESSAGE_TOO_LARGE` : type du message refusé. */
  type: z.string().max(64).optional(),
})
export type BridgeErrorPayload = z.output<typeof BridgeErrorPayload>

/** UUID v4 (navigateur, Node ≥ 19, SW). */
export function newMessageId(): string {
  return globalThis.crypto.randomUUID()
}

/** Construit une enveloppe (le `payload` n'est pas validé ici). */
export function envelope(
  type: MessageType,
  payload?: unknown,
  re?: string,
  now: number = Date.now(),
): Envelope {
  const e: Envelope = { v: BRIDGE_PROTOCOL_VERSION, id: newMessageId(), type, ts: now, payload }
  if (re) e.re = re
  return e
}
