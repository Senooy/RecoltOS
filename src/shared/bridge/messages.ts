/**
 * Payloads of each message `type` and full validation of
 * `envelope + payload`.
 */
import { z } from 'zod'
import {
  BRIDGE_PROTOCOL_VERSION,
  EXTENSION_TARGETS,
  MAX_SYNC_PAGES,
  MAX_WANTED_AUTHORS,
} from './constants'
import { BridgeErrorPayload, Envelope, Platform, type MessageType } from './envelope'
import {
  CollectionCreateMessage,
  CollectionsListResult,
  MediaChunkMessage,
  MediaFetchMessage,
  SaveAck,
  SaveRequest,
} from './save'
import {
  AuthorRef,
  AuthorSeenMessage,
  AuthorsWantedMessage,
  CapturePassiveMessage,
  ItemDataMessage,
  ItemRefreshMessage,
  SyncAckMessage,
  SyncCancelMessage,
  SyncFinishedMessage,
  SyncHintMessage,
  SyncPageMessage,
  SyncRequestMessage,
  SyncRunMessage,
  SyncStateMessage,
} from './sync'

export const HostHello = z.object({
  protocol: z.number().int(),
  browser: z.string().max(40),
  /** Caller origin (`chrome-extension://…/`) or Firefox identifier. */
  origin: z.string().max(200),
  hostVersion: z.string().max(20),
  pid: z.number().int(),
})
export type HostHello = z.output<typeof HostHello>

export const AppStatus = z.object({ connected: z.boolean() })

/** Platform state as seen by the extension (cookies read on demand, never transmitted). */
export const PlatformState = z.object({
  /** Session cookie present. */
  loggedIn: z.boolean(),
  /** NON-secret account identifier (numeric id of `twid`, `ds_user_id`, `me.id`). */
  accountId: z.string().max(64).nullable().optional(),
  handle: z.string().max(100).nullable().optional(),
  /** Host permissions granted (Firefox MV3: optional). */
  permission: z.boolean().optional(),
})
export type PlatformState = z.output<typeof PlatformState>

export const PlatformsState = z.object({
  x: PlatformState,
  instagram: PlatformState,
  cosmos: PlatformState,
})
export type PlatformsState = z.output<typeof PlatformsState>

export const Hello = z.object({
  extVersion: z.string().max(20),
  protocol: z.number().int(),
  target: z.enum(EXTENSION_TARGETS),
  browser: z.object({ name: z.string().max(40), version: z.string().max(40) }),
  profileId: z.string().max(64).nullable(),
  platforms: PlatformsState,
  openTabs: z.object({
    x: z.number().int(),
    instagram: z.number().int(),
    cosmos: z.number().int(),
  }),
})
export type Hello = z.output<typeof Hello>

export const ExtStatus = z.object({ platforms: PlatformsState })

const PerPlatform = <T extends z.ZodType>(t: T) => z.object({ x: t, instagram: t, cosmos: t })

export const HelloAck = z.object({
  appVersion: z.string().max(40),
  protocol: z.literal(BRIDGE_PROTOCOL_VERSION),
  needsReload: z.boolean(),
  bundledExtVersion: z.string().max(20),
  settings: z.object({
    sync: PerPlatform(z.boolean()),
    allowBackgroundTab: PerPlatform(z.boolean()),
    intervalsMin: PerPlatform(z.number().int().min(1)),
    maxPages: PerPlatform(z.number().int().min(1).max(MAX_SYNC_PAGES)),
    wantedAuthors: z.array(AuthorRef).max(MAX_WANTED_AUTHORS),
  }),
  /**
   * App interface language (`fr` | `en`): the extension popup, menus and toasts
   * follow it. Optional (compatibility with older apps); sent back on each change.
   */
  lang: z.enum(['fr', 'en']).optional(),
})
export type HelloAck = z.output<typeof HelloAck>

export const ExtStale = z.object({
  extVersion: z.string().max(20),
  bundledExtVersion: z.string().max(20),
})

const Nothing = z.object({}).passthrough().optional()

/** Schema of each type's `payload` (validated by the app; the host only checks `type`). */
export const MESSAGE_SCHEMAS = {
  'host.hello': HostHello,
  'app.status': AppStatus,
  hello: Hello,
  'hello.ack': HelloAck,
  'ext.status': ExtStatus,
  'save.create': SaveRequest,
  'save.ack': SaveAck,
  'sync.page': SyncPageMessage,
  'sync.run': SyncRunMessage,
  'sync.ack': SyncAckMessage,
  'sync.hint': SyncHintMessage,
  'sync.request': SyncRequestMessage,
  'sync.finished': SyncFinishedMessage,
  'sync.cancel': SyncCancelMessage,
  'sync.state': SyncStateMessage,
  'capture.passive': CapturePassiveMessage,
  'item.refresh': ItemRefreshMessage,
  'item.data': ItemDataMessage,
  'media.fetch': MediaFetchMessage,
  'media.chunk': MediaChunkMessage,
  'author.seen': AuthorSeenMessage,
  'authors.wanted': AuthorsWantedMessage,
  'ext.stale': ExtStale,
  'collections.list': Nothing,
  'collections.list.result': CollectionsListResult,
  'collections.changed': CollectionsListResult,
  'collection.create': CollectionCreateMessage,
  ping: Nothing,
  pong: Nothing,
  error: BridgeErrorPayload,
} as const satisfies Record<MessageType, z.ZodType>

export type PayloadOf<T extends MessageType> = z.output<(typeof MESSAGE_SCHEMAS)[T]>

export type TypedMessage<T extends MessageType = MessageType> = {
  [K in T]: Omit<Envelope, 'type' | 'payload'> & { type: K; payload: PayloadOf<K> }
}[T]

export type ParseResult =
  { ok: true; message: TypedMessage } | { ok: false; id: string | null; error: string }

/** Validates the envelope then the `payload` according to `type`; never throws. */
export function parseMessage(raw: unknown): ParseResult {
  const env = Envelope.safeParse(raw)
  if (!env.success) {
    const id = (raw as { id?: unknown } | null)?.id
    return { ok: false, id: typeof id === 'string' ? id : null, error: 'invalid envelope' }
  }
  const schema = (MESSAGE_SCHEMAS as Record<string, z.ZodType>)[env.data.type]
  if (!schema) return { ok: false, id: env.data.id, error: `unknown type: ${env.data.type}` }
  const p = schema.safeParse(env.data.payload)
  if (!p.success) {
    const issue = p.error.issues[0]
    return {
      ok: false,
      id: env.data.id,
      error: `${env.data.type} : ${issue ? `${issue.path.join('.')} ${issue.message}` : 'invalid'}`,
    }
  }
  return { ok: true, message: { ...env.data, payload: p.data } as TypedMessage }
}

export { Platform }
