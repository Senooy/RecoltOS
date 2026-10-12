/**
 * Store de l'éditeur : zustand + immer. `nodes` = état committé suivi par
 * l'historique ; `preview` = état éphémère d'un geste (hors historique) ; un seul `commit` par geste
 * (une entrée d'historique, un seul marquage `dirty`). La caméra vit dans un store à part
 * (`useCamera`) mis à jour à chaque image sans re-rendre les nœuds.
 */
import { produce, type Draft } from 'immer'
import { create } from 'zustand'
import type { ItemCard } from '../../../../../../shared/dto/items'
import type { Rect } from '../../../../../../shared/spaces-geometry'
import type { Camera, SpaceBackground, SpaceNode } from '../../../../../../shared/spaces-schema'
import type { Guide } from '../geometry/snap'
import { History, applySide, diffIds } from './history'
import { Persistence, type BatchPayload } from './persistence'

export type Tool = 'select' | 'hand' | 'note' | 'text' | 'rect' | 'ellipse' | 'triangle' | 'diamond'

export type BoxPatch = Partial<Pick<SpaceNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>>

export interface SpaceState {
  spaceUuid: string | null
  loaded: boolean
  name: string
  background: SpaceBackground
  nodes: Record<string, SpaceNode>
  items: Record<string, ItemCard>
  selection: string[]
  tool: Tool
  editingId: string | null
  preview: Record<string, BoxPatch> | null
  guides: Guide[]
  marquee: Rect | null
  drawerOpen: boolean
  /** Incrémenté à chaque changement de l'historique (boutons annuler / rétablir). */
  historyVersion: number
  /** Survol (priorité des vidéos actives). */
  hoverId: string | null
}

const initial = (): SpaceState => ({
  spaceUuid: null,
  loaded: false,
  name: '',
  background: 'dots',
  nodes: {},
  items: {},
  selection: [],
  tool: 'select',
  editingId: null,
  preview: null,
  guides: [],
  marquee: null,
  drawerOpen: false,
  historyVersion: 0,
  hoverId: null,
})

export const useSpace = create<SpaceState>()(() => initial())

export interface CameraState {
  camera: Camera
  /** Caméra en fin de geste (niveau de détail, culling fin). */
  settled: Camera
  moving: boolean
  view: { w: number; h: number }
}

export const useCamera = create<CameraState>()(() => ({
  camera: { x: 0, y: 0, zoom: 1 },
  settled: { x: 0, y: 0, zoom: 1 },
  moving: false,
  view: { w: 1, h: 1 },
}))

export const history = new History()

export const persistence = new Persistence({
  send: (p) => sendBatch(p),
  sendSync: (p) => window.recolt?.applyBatchSync(p),
  nodes: () => useSpace.getState().nodes,
  codeOf: (err) => (err as { code?: string } | null)?.code ?? 'internal',
  onInvalid: (n) => notify.invalid(n),
  onRetry: () => notify.retry(),
})

/** Branchements fournis par l'éditeur (RPC, toasts) : le store reste testable sans IPC. */
let sendBatch: (p: BatchPayload) => Promise<unknown> = () => Promise.resolve()
const notify = { invalid: (_n: number) => undefined as void, retry: () => undefined as void }

export function configureStore(o: {
  send: typeof sendBatch
  onInvalid: (n: number) => void
  onRetry: () => void
}): void {
  sendBatch = o.send
  notify.invalid = o.onInvalid
  notify.retry = o.onRetry
}

/** Charge un document (après vidage de l'espace précédent). */
export function loadDoc(doc: {
  uuid: string
  name: string
  background: SpaceBackground
  nodes: readonly SpaceNode[]
  items: Record<string, ItemCard>
}): void {
  history.clear()
  persistence.bind(doc.uuid)
  const nodes: Record<string, SpaceNode> = {}
  for (const n of doc.nodes) nodes[n.uuid] = n
  useSpace.setState({
    ...initial(),
    spaceUuid: doc.uuid,
    loaded: true,
    name: doc.name,
    background: doc.background,
    nodes,
    items: { ...doc.items },
    historyVersion: useSpace.getState().historyVersion + 1,
  })
}

export function resetStore(): void {
  history.clear()
  persistence.bind(null)
  useSpace.setState(initial())
}

export interface CommitOptions {
  /** Coalescence d'historique (flèches). */
  key?: string
  /** Sélection après le commit. */
  select?: string[]
}

/**
 * Applique une mutation aux nœuds committés : une entrée d'historique, un marquage `dirty`.
 * Rend les uuid touchés.
 */
export function commit(
  label: string,
  mutate: (draft: Draft<Record<string, SpaceNode>>) => void,
  o: CommitOptions = {},
): string[] {
  const before = useSpace.getState().nodes
  const after = produce(before, mutate)
  if (after === before) {
    if (o.select) useSpace.setState({ selection: o.select })
    return []
  }
  const ids = diffIds(before, after)
  const now = Date.now()
  const b: Record<string, SpaceNode | null> = {}
  const a: Record<string, SpaceNode | null> = {}
  for (const id of ids) {
    b[id] = before[id] ?? null
    a[id] = after[id] ?? null
  }
  history.push({ label, before: b, after: a, at: now, ...(o.key ? { key: o.key } : {}) })
  useSpace.setState((s) => ({
    nodes: after,
    selection: o.select ?? s.selection.filter((id) => after[id]),
    historyVersion: s.historyVersion + 1,
  }))
  persistence.mark(ids)
  return ids
}

function applyEntry(side: 'before' | 'after'): boolean {
  const e = side === 'before' ? history.undo() : history.redo()
  if (!e) return false
  const { nodes, ids } = applySide(useSpace.getState().nodes, e[side])
  useSpace.setState((s) => ({
    nodes,
    selection: ids.filter((id) => nodes[id]),
    preview: null,
    editingId: null,
    historyVersion: s.historyVersion + 1,
  }))
  persistence.mark(ids)
  return true
}

export const undo = (): boolean => applyEntry('before')
export const redo = (): boolean => applyEntry('after')

export function setTool(tool: Tool): void {
  useSpace.setState({ tool, editingId: null })
}

export function setSelection(ids: string[]): void {
  useSpace.setState({ selection: [...new Set(ids)] })
}

export function setPreview(p: Record<string, BoxPatch> | null, guides: Guide[] = []): void {
  useSpace.setState({ preview: p, guides })
}

export function setMarquee(r: Rect | null): void {
  useSpace.setState({ marquee: r })
}

export function setName(name: string): void {
  useSpace.setState({ name })
  persistence.setMeta({ name })
}

export function setBackground(background: SpaceBackground): void {
  useSpace.setState({ background })
  persistence.setMeta({ background })
}

export function addItemCards(cards: readonly ItemCard[]): void {
  if (cards.length === 0) return
  useSpace.setState((s) => {
    const items = { ...s.items }
    for (const c of cards) items[c.uuid] = c
    return { items }
  })
}

export function setCamera(camera: Camera, o: { settle?: boolean; moving?: boolean } = {}): void {
  useCamera.setState((s) => ({
    camera,
    ...(o.settle ? { settled: camera } : {}),
    moving: o.moving ?? s.moving,
  }))
}

/** z suivant (au-dessus de tout). */
export function nextZ(): number {
  let z = -1
  for (const n of Object.values(useSpace.getState().nodes)) if (n.z > z) z = n.z
  return z + 1
}

/** Nœuds triés par z croissant. */
export function sortedNodes(nodes: Record<string, SpaceNode>): SpaceNode[] {
  return Object.values(nodes).sort((a, b) => a.z - b.z || (a.uuid < b.uuid ? -1 : 1))
}

/** Validation de l'édition de texte en cours (note, texte, forme) : branchée par le nœud édité. */
let editingCommit: (() => void) | null = null

export function registerEditingCommit(fn: (() => void) | null): void {
  editingCommit = fn
}

export function commitEditing(): void {
  const fn = editingCommit
  if (fn) fn()
}
