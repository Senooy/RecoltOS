/**
 * Editor operations: node creation, deletion, duplication,
 * keyboard movement, order, alignment, lock, style, clipboard, adding items from the
 * library and files, zoom. Each operation = a single `commit` (one history entry).
 */
import type { AssetInfo } from '../../../../../shared/dto/spaces'
import type { ItemCard } from '../../../../../shared/dto/items'
import { newUuid } from '../../../../../shared/ids'
import {
  defaultImageStyle,
  defaultItemStyle,
  defaultNoteStyle,
  defaultShapeStyle,
  defaultTextStyle,
  type ShapeKind,
} from '../../../../../shared/spaces-defaults'
import {
  ASSET_LONG_SIDE,
  NOTE_SIZE,
  SHAPE_SIZE,
  aabb,
  defaultItemSize,
  fitLongSide,
  gridPlacement,
  unionRect,
  type Rect,
  type Vec,
} from '../../../../../shared/spaces-geometry'
import {
  MAX_NODES_PER_SPACE,
  sanitizeNode,
  type SpaceNode,
} from '../../../../../shared/spaces-schema'
import { toast } from '../../../components/ui'
import { tr } from '../../../i18n'
import { RpcError, rpc } from '../../../lib/rpc'
import { align, distribute, reorder, type AlignKind } from './geometry/align'
import { clampZoom, fitBox, screenToWorld, stepZoom, zoomAt } from './geometry/camera'
import {
  addItemCards,
  commit,
  nextZ,
  setCamera,
  sortedNodes,
  useCamera,
  useSpace,
  type Tool,
} from './store/spaceStore'

const t = () => tr.spacesUi

export function fail(err: unknown): void {
  toast(err instanceof RpcError ? err.message : tr.errors.generic)
}

function base(at: Vec, w: number, h: number, centered = true) {
  const now = Date.now()
  return {
    uuid: newUuid(),
    x: Math.round(centered ? at.x - w / 2 : at.x),
    y: Math.round(centered ? at.y - h / 2 : at.y),
    width: w,
    height: h,
    rotation: 0,
    z: nextZ(),
    locked: false,
    createdAt: now,
    updatedAt: now,
  }
}

export function makeNote(at: Vec): SpaceNode {
  return { ...base(at, NOTE_SIZE, NOTE_SIZE), type: 'note', content: '', style: defaultNoteStyle() }
}

export function makeShape(kind: ShapeKind, at: Vec): SpaceNode {
  return {
    ...base(at, SHAPE_SIZE.width, SHAPE_SIZE.height),
    type: 'shape',
    content: '',
    style: defaultShapeStyle(kind),
  }
}

export function makeText(at: Vec): SpaceNode {
  return { ...base(at, 160, 40), type: 'text', content: '', style: defaultTextStyle() }
}

/** Creates the tool's node at the world point and enters edit mode (note, text, shape). */
export function createAt(tool: Tool, at: Vec): string | null {
  let node: SpaceNode
  if (tool === 'note') node = makeNote(at)
  else if (tool === 'text') node = makeText(at)
  else if (tool === 'rect' || tool === 'ellipse' || tool === 'triangle' || tool === 'diamond')
    node = makeShape(tool, at)
  else return null
  if (!guardCap(1)) return null
  commit(
    tool === 'note'
      ? tr.spaces.tools.note
      : tool === 'text'
        ? tr.spaces.tools.text
        : tr.spaces.tools.rect,
    (d) => {
      d[node.uuid] = node
    },
    { select: [node.uuid] },
  )
  useSpace.setState({
    tool: 'select',
    editingId: node.type === 'note' || node.type === 'text' ? node.uuid : null,
  })
  return node.uuid
}

function guardCap(n: number): boolean {
  if (Object.keys(useSpace.getState().nodes).length + n > MAX_NODES_PER_SPACE) {
    toast(tr.spaces.maxSize)
    return false
  }
  return true
}

const selected = (): SpaceNode[] => {
  const s = useSpace.getState()
  return s.selection.map((id) => s.nodes[id]).filter((n): n is SpaceNode => Boolean(n))
}

export function deleteSelection(): void {
  const ids = selected().map((n) => n.uuid)
  if (ids.length === 0) return
  commit(
    tr.spacesUi.delete,
    (d) => {
      for (const id of ids) delete d[id]
    },
    { select: [] },
  )
}

/** Offset copy of nodes (new uuids, on top); returns the new uuids. */
function cloneNodes(nodes: readonly SpaceNode[], dx: number, dy: number): SpaceNode[] {
  let z = nextZ()
  const now = Date.now()
  return [...nodes]
    .sort((a, b) => a.z - b.z)
    .map((n) => ({
      ...n,
      uuid: newUuid(),
      x: n.x + dx,
      y: n.y + dy,
      z: z++,
      locked: false,
      createdAt: now,
      updatedAt: now,
    }))
}

export function duplicateSelection(offset = 24): string[] {
  const nodes = selected()
  if (nodes.length === 0 || !guardCap(nodes.length)) return []
  const copies = cloneNodes(nodes, offset, offset)
  commit(
    t().duplicate,
    (d) => {
      for (const c of copies) d[c.uuid] = c
    },
    { select: copies.map((c) => c.uuid) },
  )
  return copies.map((c) => c.uuid)
}

/** Duplicates in place (⌥+drag): the copy stays selected and will be moved. */
export function duplicateInPlace(ids: readonly string[]): string[] {
  const s = useSpace.getState()
  const nodes = ids.map((id) => s.nodes[id]).filter((n): n is SpaceNode => Boolean(n))
  if (!guardCap(nodes.length)) return []
  const copies = cloneNodes(nodes, 0, 0)
  commit(
    t().duplicate,
    (d) => {
      for (const c of copies) d[c.uuid] = c
    },
    { select: copies.map((c) => c.uuid) },
  )
  return copies.map((c) => c.uuid)
}

export function nudge(dx: number, dy: number): void {
  const nodes = selected().filter((n) => !n.locked)
  if (nodes.length === 0) return
  const key = `nudge:${nodes.map((n) => n.uuid).join(',')}`
  commit(
    'Déplacer',
    (d) => {
      for (const n of nodes) {
        const m = d[n.uuid]!
        m.x += dx
        m.y += dy
      }
    },
    { key },
  )
}

export function reorderSelection(op: 'forward' | 'backward' | 'front' | 'back'): void {
  const sel = useSpace.getState().selection
  if (sel.length === 0) return
  const order = sortedNodes(useSpace.getState().nodes).map((n) => n.uuid)
  const z = reorder(order, sel, op)
  commit(op === 'front' || op === 'forward' ? t().bringToFront : t().sendToBack, (d) => {
    for (const [id, v] of Object.entries(z)) if (d[id] && d[id].z !== v) d[id].z = v
  })
}

export function alignSelection(kind: AlignKind): void {
  const nodes = selected().filter((n) => !n.locked)
  const p = align(nodes, kind)
  commit('Aligner', (d) => {
    for (const [id, v] of Object.entries(p)) Object.assign(d[id]!, v)
  })
}

export function distributeSelection(axis: 'h' | 'v'): void {
  const nodes = selected().filter((n) => !n.locked)
  const p = distribute(nodes, axis)
  commit('Répartir', (d) => {
    for (const [id, v] of Object.entries(p)) Object.assign(d[id]!, v)
  })
}

export function toggleLock(): void {
  const nodes = selected()
  if (nodes.length === 0) return
  const lock = nodes.some((n) => !n.locked)
  commit(lock ? t().lock : t().unlock, (d) => {
    for (const n of nodes) d[n.uuid]!.locked = lock
  })
}

/** Merges `patch` into the style of the selected nodes of the given type. */
export function setStyle(
  types: readonly SpaceNode['type'][],
  patch: Record<string, unknown>,
  label: string = t().color,
): void {
  const nodes = selected().filter((n) => types.includes(n.type))
  if (nodes.length === 0) return
  commit(label, (d) => {
    for (const n of nodes) {
      const m = d[n.uuid]!
      m.style = { ...m.style, ...patch }
    }
  })
}

export function setContent(uuid: string, content: string): void {
  const n = useSpace.getState().nodes[uuid]
  if (!n || (n.type !== 'note' && n.type !== 'text' && n.type !== 'shape') || n.content === content)
    return
  commit(n.type === 'note' ? 'Modifier la note' : 'Modifier le texte', (d) => {
    const m = d[uuid]
    if (m && 'content' in m) m.content = content
  })
}

export function selectAll(): void {
  useSpace.setState((s) => ({ selection: Object.keys(s.nodes), editingId: null }))
}

// --- Camera -------------------------------------------------------------------------------

const viewCenter = (): Vec => {
  const v = useCamera.getState().view
  return { x: v.w / 2, y: v.h / 2 }
}

/** Center of the view in world coordinates. */
export function viewCenterWorld(): Vec {
  return screenToWorld(useCamera.getState().camera, viewCenter())
}

export function zoomBy(factor: number, anchor: Vec = viewCenter()): void {
  const c = useCamera.getState().camera
  setCamera(zoomAt(c, anchor, clampZoom(c.zoom * factor)), { settle: true })
}

export function zoomStep(dir: 1 | -1): void {
  const c = useCamera.getState().camera
  setCamera(zoomAt(c, viewCenter(), stepZoom(c.zoom, dir)), { settle: true })
}

export function zoomTo(z: number): void {
  const c = useCamera.getState().camera
  setCamera(zoomAt(c, viewCenter(), z), { settle: true })
}

function fitRect(r: Rect | null): void {
  if (!r) return
  const { view } = useCamera.getState()
  setCamera(fitBox(view, r, 64, 1), { settle: true })
}

export function fitAll(): void {
  fitRect(unionRect(Object.values(useSpace.getState().nodes).map(aabb)))
}

export function fitSelection(): void {
  const nodes = selected()
  fitRect(
    unionRect((nodes.length > 0 ? nodes : Object.values(useSpace.getState().nodes)).map(aabb)),
  )
}

// --- Library and files ------------------------------------------------------------

/** Library items placed in a grid centered on `at` (a single commit). */
export function addItemsAt(cards: readonly ItemCard[], at: Vec = viewCenterWorld()): string[] {
  if (cards.length === 0 || !guardCap(cards.length)) return []
  addItemCards(cards)
  const sizes = cards.map((c) =>
    defaultItemSize({ kind: c.kind, width: c.width ?? null, height: c.height ?? null }),
  )
  const pos = gridPlacement(sizes, at, { center: true })
  let z = nextZ()
  const now = Date.now()
  const nodes: SpaceNode[] = cards.map((c, i) => ({
    uuid: newUuid(),
    type: 'item',
    itemUuid: c.uuid,
    x: Math.round(pos[i]!.x),
    y: Math.round(pos[i]!.y),
    width: sizes[i]!.width,
    height: sizes[i]!.height,
    rotation: 0,
    z: z++,
    locked: false,
    createdAt: now,
    updatedAt: now,
    style: defaultItemStyle(),
  }))
  commit(
    `Ajouter ${nodes.length} éléments`,
    (d) => {
      for (const n of nodes) d[n.uuid] = n
    },
    { select: nodes.map((n) => n.uuid) },
  )
  return nodes.map((n) => n.uuid)
}

function imageNodes(assets: readonly AssetInfo[], at: Vec): SpaceNode[] {
  const sizes = assets.map((a) => fitLongSide(a.naturalWidth, a.naturalHeight, ASSET_LONG_SIDE))
  const pos = gridPlacement(sizes, at, { center: true })
  let z = nextZ()
  const now = Date.now()
  return assets.map((a, i) => ({
    uuid: newUuid(),
    type: 'image',
    assetRel: a.assetRel,
    assetUrl: a.assetUrl,
    assetThumbUrl: a.thumbUrl,
    x: Math.round(pos[i]!.x),
    y: Math.round(pos[i]!.y),
    width: sizes[i]!.width,
    height: sizes[i]!.height,
    rotation: 0,
    z: z++,
    locked: false,
    createdAt: now,
    updatedAt: now,
    style: defaultImageStyle(a),
  }))
}

/** Finder files → assets (never in the library) → image nodes at the point. */
export async function addFilesAt(
  paths: readonly string[],
  at: Vec = viewCenterWorld(),
): Promise<void> {
  const space = useSpace.getState().spaceUuid
  if (!space || paths.length === 0) return
  if (paths.length > 200) {
    toast(t().tooManyFiles)
    return
  }
  try {
    const assets = await rpc('spaces.addAssets', { spaceUuid: space, paths: [...paths] })
    if (assets.length < paths.length) toast(t().filesIgnored(paths.length - assets.length))
    placeAssetsAt(assets, at)
  } catch (err) {
    fail(err)
  }
}

export async function addBufferAt(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  at: Vec = viewCenterWorld(),
): Promise<void> {
  const space = useSpace.getState().spaceUuid
  if (!space) return
  try {
    const a = await rpc('spaces.addAssetBuffer', { spaceUuid: space, bytes, mime })
    placeAssetsAt([a], at)
  } catch (err) {
    fail(err)
  }
}

export function placeAssetsAt(assets: readonly AssetInfo[], at: Vec = viewCenterWorld()): void {
  if (assets.length === 0 || !guardCap(assets.length)) return
  const nodes = imageNodes(assets, at)
  commit(
    `Ajouter ${nodes.length} images`,
    (d) => {
      for (const n of nodes) d[n.uuid] = n
    },
    { select: nodes.map((n) => n.uuid) },
  )
  toast(t().imagesAdded(nodes.length), {
    action: { label: t().addToLibrary, onClick: () => void promoteNodes(nodes.map((n) => n.uuid)) },
  })
}

/** "Add to library": the asset becomes an item, the node becomes `item`. */
export async function promoteNodes(ids: readonly string[]): Promise<void> {
  const space = useSpace.getState().spaceUuid
  if (!space) return
  const done: { id: string; itemUuid: string }[] = []
  for (const id of ids) {
    const n = useSpace.getState().nodes[id]
    if (!n || n.type !== 'image') continue
    try {
      const r = await rpc('spaces.promoteAsset', { spaceUuid: space, nodeUuid: id })
      done.push({ id, itemUuid: r.itemUuid })
    } catch (err) {
      fail(err)
    }
  }
  if (done.length === 0) return
  const cards = await Promise.all(
    done.map((d) => rpc('items.get', { uuid: d.itemUuid }).catch(() => null)),
  )
  addItemCards(cards.filter((c): c is NonNullable<typeof c> => c !== null))
  commit(t().addToLibrary, (d) => {
    for (const { id, itemUuid } of done) {
      const n = d[id]
      if (!n || n.type !== 'image') continue
      const { fit, radius, border, lockAspect, opacity } = n.style
      d[id] = {
        uuid: n.uuid,
        type: 'item',
        itemUuid,
        x: n.x,
        y: n.y,
        width: n.width,
        height: n.height,
        rotation: n.rotation,
        z: n.z,
        locked: n.locked,
        createdAt: n.createdAt,
        updatedAt: Date.now(),
        style: { fit, radius, border, lockAspect, ...(opacity !== undefined ? { opacity } : {}) },
      }
    }
  })
  toast(t().addedToLibrary)
}

// --- Clipboard ------------------------------------------------------------------------

interface ClipPayload {
  v: 1
  nodes: SpaceNode[]
  items: Record<string, ItemCard>
}

export async function copySelection(cut = false): Promise<void> {
  const nodes = selected()
  if (nodes.length === 0) return
  const items = useSpace.getState().items
  const payload: ClipPayload = { v: 1, nodes, items: {} }
  for (const n of nodes)
    if (n.type === 'item' && n.itemUuid && items[n.itemUuid])
      payload.items[n.itemUuid] = items[n.itemUuid]!
  const text = nodes
    .map((n) => (n.type === 'note' || n.type === 'text' || n.type === 'shape' ? n.content : ''))
    .filter(Boolean)
    .join('\n\n')
  try {
    await rpc('spaces.clipboardWrite', { nodesJson: JSON.stringify(payload), text })
    if (cut) deleteSelection()
  } catch (err) {
    fail(err)
  }
}

/** ⌘V: internal nodes, files, image, text (priority order of main). */
export async function pasteClipboard(at?: Vec): Promise<void> {
  let c: Awaited<ReturnType<typeof rpc<'spaces.readClipboard'>>>
  try {
    c = await rpc('spaces.readClipboard')
  } catch (err) {
    fail(err)
    return
  }
  if (!c) {
    toast(t().pasteEmpty)
    return
  }
  if (c.kind === 'nodes') {
    pasteNodes(c.nodesJson)
    return
  }
  const point = at ?? viewCenterWorld()
  if (c.kind === 'files') await addFilesAt(c.paths, point)
  else if (c.kind === 'image') await addBufferAt(c.bytes, 'image/png', point)
  else {
    const n = makeText(point)
    if (n.type !== 'text') return
    n.content = c.text.slice(0, 20_000)
    n.width = Math.min(480, Math.max(80, c.text.length * 9))
    n.style = { ...n.style, fontSize: 18, autoWidth: false }
    n.height = Math.max(40, Math.ceil(c.text.length / 50) * 26)
    commit(
      t().paste,
      (d) => {
        d[n.uuid] = n
      },
      { select: [n.uuid] },
    )
  }
}

export function pasteNodes(json: string, offset = 24): void {
  let payload: ClipPayload
  try {
    payload = JSON.parse(json) as ClipPayload
  } catch {
    return
  }
  const raw = Array.isArray(payload.nodes) ? payload.nodes : []
  const valid = raw.map((n) => sanitizeNode(n)).filter((n): n is SpaceNode => n !== null)
  if (valid.length === 0 || !guardCap(valid.length)) return
  addItemCards(Object.values(payload.items ?? {}))
  const copies = cloneNodes(valid, offset, offset)
  commit(
    t().paste,
    (d) => {
      for (const c of copies) d[c.uuid] = c
    },
    { select: copies.map((c) => c.uuid) },
  )
}
