/**
 * Contrat `spaces.*` (PLAN §4.4, SPACES §1.7.2 adapté : uuid, `itemUuids`).
 * `exportPng`/`exportCancel` (WP-63) déclarés dès maintenant (extensions incluses en V1, ERRATA §G).
 */
import { z } from 'zod'
import { AssetInfo, SpaceDoc, SpaceSummary } from '../dto/spaces'
import { Uuid } from '../enums'
import {
  Camera,
  MAX_BATCH_DELETE,
  MAX_BATCH_UPSERT,
  SpaceBackground,
  SpaceNode,
} from '../spaces-schema'
import { AbsPath, Empty, Void, type ContractShape, type EventShape } from './define'

const Name = z.string().trim().max(200)

export const ApplyBatchInput = z.object({
  spaceUuid: Uuid,
  upsert: z.array(SpaceNode).max(MAX_BATCH_UPSERT),
  delete: z.array(Uuid).max(MAX_BATCH_DELETE),
  viewport: Camera.optional(),
  name: Name.optional(),
  background: SpaceBackground.optional(),
})
export type ApplyBatchInput = z.input<typeof ApplyBatchInput>

export const ClipboardContent = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('nodes'), nodesJson: z.string() }),
    z.object({ kind: z.literal('files'), paths: z.array(z.string()) }),
    z.object({ kind: z.literal('image'), bytes: z.instanceof(Uint8Array) }),
    z.object({ kind: z.literal('text'), text: z.string() }),
  ])
  .nullable()

export const spacesContract = {
  'spaces.list': { input: Empty, output: z.array(SpaceSummary) },
  'spaces.create': {
    input: z.object({ name: Name.optional() }).default({}),
    output: z.object({ uuid: Uuid }),
  },
  'spaces.get': { input: z.object({ uuid: Uuid }), output: SpaceDoc },
  /** Atomique (une transaction) ; ≤ 5 000 upserts + 5 000 suppressions. */
  'spaces.applyBatch': {
    input: ApplyBatchInput,
    output: z.object({ updatedAt: z.number().int() }),
  },
  'spaces.rename': { input: z.object({ uuid: Uuid, name: Name }), output: Void },
  'spaces.duplicate': { input: z.object({ uuid: Uuid }), output: z.object({ uuid: Uuid }) },
  'spaces.delete': { input: z.object({ uuid: Uuid }), output: Void },
  'spaces.addItems': {
    input: z.object({ spaceUuid: Uuid, itemUuids: z.array(Uuid).min(1).max(MAX_BATCH_UPSERT) }),
    output: z.object({ added: z.number().int() }),
  },
  'spaces.addAssets': {
    input: z.object({ spaceUuid: Uuid, paths: z.array(AbsPath).min(1).max(500) }),
    output: z.array(AssetInfo),
  },
  'spaces.addAssetBuffer': {
    input: z.object({
      spaceUuid: Uuid,
      bytes: z.instanceof(Uint8Array),
      mime: z.string().max(100),
    }),
    output: AssetInfo,
  },
  'spaces.promoteAsset': {
    input: z.object({ spaceUuid: Uuid, nodeUuid: Uuid }),
    output: z.object({ itemUuid: Uuid }),
  },
  'spaces.clipboardWrite': {
    input: z.object({ nodesJson: z.string().max(5_000_000), text: z.string().max(100_000) }),
    output: Void,
  },
  'spaces.readClipboard': { input: Empty, output: ClipboardContent },
  'spaces.exportPng': {
    input: z.object({
      uuid: Uuid,
      scope: z.enum(['all', 'selection']),
      nodeUuids: z.array(Uuid).optional(),
      scale: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      background: z.enum(['light', 'dark', 'theme']),
      name: z.string().max(200),
    }),
    output: z.union([z.object({ path: z.string() }), z.object({ cancelled: z.literal(true) })]),
  },
  'spaces.exportCancel': { input: Empty, output: Void },
} as const satisfies ContractShape

export const spacesEvents = {
  'spaces.changed': z.object({ uuids: z.array(Uuid) }),
  'spaces.exportProgress': z.object({ done: z.number().int(), total: z.number().int() }),
} as const satisfies EventShape
