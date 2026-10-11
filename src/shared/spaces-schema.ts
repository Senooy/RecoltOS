/**
 * Spaces : types et schémas partagés (SPACES §1.2.2, adaptés par PLAN §1.1, §1.11, §4.2).
 * Renommages : `id` → `uuid`, `saveId` → `itemUuid`, `assetPath` → `assetRel`, `zIndex` → `z`.
 * Les mêmes schémas servent à la frontière IPC (main) et au `sanitizeNode` du renderer.
 */
import { z } from 'zod'
import { MediaUrl } from './enums'

/** Constante UNIQUE : CHECK SQL (`width >= 24`), schéma zod et UI. */
export const MIN_NODE_SIZE = 24
export const MAX_NODE_SIZE = 50_000
export const WORLD_LIMIT = 1_000_000
export const MAX_NODE_CONTENT = 20_000
/** Par appel `spaces.applyBatch` (le client découpe). */
export const MAX_BATCH_UPSERT = 5_000
export const MAX_BATCH_DELETE = 5_000
/** Plafond dur par espace. */
export const MAX_NODES_PER_SPACE = 20_000
/** `spaces:applyBatchSync` (beforeunload) : un seul sous-lot. */
export const MAX_SYNC_BATCH = 2_000
/** Taille de sous-lot côté client (SPACES §1.7.1). */
export const FLUSH_CHUNK = 2_000

export const NODE_TYPES = ['item', 'image', 'note', 'shape', 'text'] as const
export const NodeType = z.enum(NODE_TYPES)
export type NodeType = z.output<typeof NodeType>

/** Couleurs résolues selon le thème (ex. `ink` = #1D1D1F clair / #F5F5F7 sombre). */
export const ColorToken = z.enum([
  'ink',
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'white',
])
export type ColorToken = z.output<typeof ColorToken>

/** 6 couleurs de notes (PLAN §1.11, DESIGN §3.11) ; valeurs dans `tokens.css` (`--note-*`). */
export const NOTE_COLORS = ['yellow', 'pink', 'green', 'blue', 'purple', 'gray'] as const
export const NoteColor = z.enum(NOTE_COLORS)
export type NoteColor = z.output<typeof NoteColor>

export const NOTE_COLOR_HEX: Readonly<Record<NoteColor, string>> = {
  yellow: '#fff4b8',
  pink: '#ffd6e0',
  green: '#d8f5d0',
  blue: '#d6e8ff',
  purple: '#e6deff',
  gray: '#efefef',
}

const finite = z.number().finite()
const coord = finite.min(-WORLD_LIMIT).max(WORLD_LIMIT)
const size = finite.min(MIN_NODE_SIZE).max(MAX_NODE_SIZE)
const opacity = z.number().min(0).max(1).optional()

/** Rotation en degrés normalisée dans ]-180, 180]. */
export function normalizeRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0
  let r = deg % 360
  if (r <= -180) r += 360
  if (r > 180) r -= 360
  return r
}

export const MediaStyle = z.strictObject({
  fit: z.enum(['cover', 'contain']),
  radius: z.union([z.literal(0), z.literal(8), z.literal(16)]),
  border: z.boolean(),
  lockAspect: z.boolean(),
  opacity,
  /** Carrousel : index de l'image affichée (défaut 0). */
  mediaIndex: z.number().int().min(0).optional(),
})
export const ItemStyle = MediaStyle.extend({
  /** Hauteur naturelle d'une carte post/page mesurée à 360 px. */
  contentHeight: z.number().positive().optional(),
})
export const ImageStyle = MediaStyle.extend({
  mime: z.string().max(100),
  naturalWidth: z.number().int().positive(),
  naturalHeight: z.number().int().positive(),
  kind: z.enum(['image', 'video']),
})
export const NoteStyle = z.strictObject({
  color: NoteColor,
  fontSize: z.union([z.literal(14), z.literal(18), z.literal(24), z.literal(32)]),
  align: z.enum(['left', 'center', 'right']),
  opacity,
})
export const TextStyle = z.strictObject({
  fontSize: z.number().min(12).max(160),
  weight: z.union([z.literal(400), z.literal(600)]),
  font: z.enum(['sans', 'serif', 'mono']),
  color: ColorToken,
  align: z.enum(['left', 'center', 'right']),
  autoWidth: z.boolean(),
  opacity,
})
export const ShapeStyle = z.strictObject({
  /** `triangle` et `diamond` : extension WP-63 (incluse en V1, ERRATA §G). */
  kind: z.enum(['rect', 'ellipse', 'triangle', 'diamond']),
  fill: ColorToken.nullable(),
  fillAlpha: z.number().min(0).max(1),
  stroke: ColorToken.nullable(),
  strokeWidth: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  dash: z.enum(['solid', 'dashed']),
  radius: z.number().min(0).max(1000),
  fontSize: z.union([z.literal(14), z.literal(18), z.literal(24), z.literal(32)]),
  textColor: ColorToken,
  opacity,
})

const Base = {
  uuid: z.uuid(),
  x: coord,
  y: coord,
  width: size,
  height: size,
  /** Degrés autour du centre (WP-63). */
  rotation: finite.min(-180).max(180).default(0),
  z: z.number().int(),
  locked: z.boolean().default(false),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
}
const content = z.string().max(MAX_NODE_CONTENT)

export const ItemNode = z.object({
  ...Base,
  type: z.literal('item'),
  /** `null` si l'élément a été purgé (« Élément supprimé »). */
  itemUuid: z.uuid().nullable(),
  style: ItemStyle,
})
export const ImageNode = z.object({
  ...Base,
  type: z.literal('image'),
  /** `spaces/assets/<ab>/<sha256>.<ext>`, relatif à la racine de la bibliothèque. */
  assetRel: z.string().regex(/^spaces\/assets\/[0-9a-f]{2}\/[0-9a-f]{64}\.[a-z0-9]{2,5}$/),
  /** Rempli par main dans `spaces.get` (lecture seule, ignoré à l'écriture). */
  assetUrl: MediaUrl.nullable().optional(),
  assetThumbUrl: MediaUrl.nullable().optional(),
  style: ImageStyle,
})
export const NoteNode = z.object({ ...Base, type: z.literal('note'), content, style: NoteStyle })
export const ShapeNode = z.object({ ...Base, type: z.literal('shape'), content, style: ShapeStyle })
export const TextNode = z.object({ ...Base, type: z.literal('text'), content, style: TextStyle })

export const SpaceNode = z.discriminatedUnion('type', [
  ItemNode,
  ImageNode,
  NoteNode,
  ShapeNode,
  TextNode,
])
export type SpaceNode = z.output<typeof SpaceNode>
export type SpaceNodeInput = z.input<typeof SpaceNode>

export const SpaceBackground = z.enum(['dots', 'grid', 'plain'])
export type SpaceBackground = z.output<typeof SpaceBackground>

export const Camera = z.object({
  x: finite,
  y: finite,
  zoom: z.number().min(0.1).max(4),
})
export type Camera = z.output<typeof Camera>

/** Valide un nœud produit par l'app ; renvoie `null` s'il est invalide. */
export function sanitizeNode(raw: unknown): SpaceNode | null {
  const r = SpaceNode.safeParse(raw)
  if (!r.success) return null
  return { ...r.data, rotation: normalizeRotation(r.data.rotation) }
}
