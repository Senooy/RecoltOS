/**
 * JSON Schema v1 export of the protocol, generated from zod (`z.toJSONSchema`, draft 2020-12).
 * `pnpm run gen:bridge-schema` writes `src/shared/bridge/schema/v1.json`; a test checks that it is up to date.
 */
import { z } from 'zod'
import { Envelope, Platform, Trigger } from './envelope'
import { MESSAGE_SCHEMAS } from './messages'
import { SaveRequest } from './save'
import { SyncAckMessage, SyncPageMessage, SyncRunMessage } from './sync'

type Json = Record<string, unknown>

function toSchema(t: z.ZodType): Json {
  const s = z.toJSONSchema(t, {
    target: 'draft-2020-12',
    unrepresentable: 'any',
    io: 'input',
  }) as Json
  delete s.$schema
  return s
}

export function bridgeJsonSchema(): Json {
  const saveRequest = toSchema(SaveRequest)
  // The exclusivity `refine` cannot be represented by zod: we express it as
  saveRequest.not = { required: ['inlineMedia', 'upload'] }
  const payloads: Json = {}
  for (const [type, schema] of Object.entries(MESSAGE_SCHEMAS)) payloads[type] = toSchema(schema)
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'recoltos:bridge/v1',
    $defs: {
      Envelope: toSchema(Envelope),
      Platform: toSchema(Platform),
      Trigger: toSchema(Trigger),
      SaveRequest: saveRequest,
      SyncRun: toSchema(SyncRunMessage),
      SyncPage: toSchema(SyncPageMessage),
      SyncAck: toSchema(SyncAckMessage),
      payloads,
    },
  }
}
