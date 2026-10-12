/**
 * Spaces DTO: `SpaceDoc {space, nodes, items}`;
 * list thumbnail = reduced DOM rendering of the first 20 nodes (no generated image).
 */
import { z } from 'zod'
import { MediaUrl, Uuid } from '../enums'
import { Camera, SpaceBackground, SpaceNode } from '../spaces-schema'
import { ItemCard } from './items'

export const SpaceMeta = z.object({
  uuid: Uuid,
  name: z.string(),
  viewport: Camera,
  background: SpaceBackground,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  viewedAt: z.number().int().nullable(),
})
export type SpaceMeta = z.output<typeof SpaceMeta>

export const SPACE_PREVIEW_NODES = 20

export const SpaceSummary = z.object({
  uuid: Uuid,
  name: z.string(),
  background: SpaceBackground,
  nodeCount: z.number().int().min(0),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  /** First 20 nodes (z order) and their items, for the reduced DOM thumbnail. */
  preview: z.object({
    nodes: z.array(SpaceNode).max(SPACE_PREVIEW_NODES),
    items: z.record(z.string(), ItemCard),
  }),
})
export type SpaceSummary = z.output<typeof SpaceSummary>

export const SpaceDoc = z.object({
  space: SpaceMeta,
  nodes: z.array(SpaceNode),
  /** Items referenced by the `item` nodes, indexed by uuid. */
  items: z.record(z.string(), ItemCard),
})
export type SpaceDoc = z.output<typeof SpaceDoc>

export const AssetInfo = z.object({
  assetRel: z.string(),
  assetUrl: MediaUrl,
  thumbUrl: MediaUrl.nullable(),
  mime: z.string(),
  kind: z.enum(['image', 'video']),
  naturalWidth: z.number().int().positive(),
  naturalHeight: z.number().int().positive(),
})
export type AssetInfo = z.output<typeof AssetInfo>
