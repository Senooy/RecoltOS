/**
 * Import des boards GatherOS (SPACES §1.10) : `boards` → `spaces` (origine `gatheros`, idempotent
 * par `origin_id`), `board_items` → `space_nodes`. Colonnes nullables (`width`, `height`,
 * `rotation`) : `MAX(24, COALESCE(valeur, défaut du type))`, rotation normalisée. Un item dont
 * `data` désigne un save connu devient un nœud `item` ; notes / formes / textes gardent leur
 * contenu ; le reste (images sans fichier exploitable, types inconnus) est compté dans `skipped`
 * et journalisé. Aucune ligne chez l'utilisateur : validé seulement sur fixture synthétique.
 */
import type Database from 'better-sqlite3'
import { newUuid } from '../../shared/ids'
import {
  defaultItemStyle,
  defaultNoteStyle,
  defaultShapeStyle,
  defaultTextStyle,
} from '../../shared/spaces-defaults'
import { NOTE_SIZE, SHAPE_SIZE } from '../../shared/spaces-geometry'
import {
  MIN_NODE_SIZE,
  NOTE_COLORS,
  normalizeRotation,
  type NoteColor,
} from '../../shared/spaces-schema'
import type { SpaceNodeInput } from '../db/repos/spaces'
import type { LibraryContext } from '../library/library-context'

export interface BoardsImportResult {
  spaces: number
  nodes: number
  skipped: number
  existing: number
}

interface BoardRow {
  id: string
  name: string | null
  created_at: number | null
  updated_at: number | null
  order_index: number | null
}

interface BoardItemRow {
  id: string
  board_id: string
  type: string | null
  x: number | null
  y: number | null
  width: number | null
  height: number | null
  rotation: number | null
  z_index: number | null
  data: string | null
}

const DEFAULTS: Record<string, { width: number; height: number }> = {
  note: { width: NOTE_SIZE, height: NOTE_SIZE },
  shape: SHAPE_SIZE,
  text: { width: 240, height: 40 },
  item: { width: 320, height: 320 },
  image: { width: 320, height: 320 },
}

const hasTable = (db: Database.Database, name: string) =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
  undefined

function parseData(s: string | null): Record<string, unknown> {
  if (!s) return {}
  try {
    const v: unknown = JSON.parse(s)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

function noteColor(v: unknown): NoteColor {
  const s = typeof v === 'string' ? v.toLowerCase() : ''
  if ((NOTE_COLORS as readonly string[]).includes(s)) return s as NoteColor
  if (s.includes('pink') || s.includes('rose')) return 'pink'
  if (s.includes('green') || s.includes('vert')) return 'green'
  if (s.includes('blue') || s.includes('bleu')) return 'blue'
  if (s.includes('purple') || s.includes('violet')) return 'purple'
  if (s.includes('gray') || s.includes('grey') || s.includes('gris')) return 'gray'
  return 'yellow'
}

/** Identifiant de save GatherOS référencé par `data`, s'il existe. */
function saveRef(type: string, data: Record<string, unknown>): string | null {
  return (
    str(data.saveId) ??
    str(data.save_id) ??
    str(data.itemId) ??
    (type === 'save' || type === 'item' ? str(data.id) : null)
  )
}

export function importGatherosBoards(
  legacy: Database.Database,
  lib: Pick<LibraryContext, 'db' | 'repos'>,
  opts: {
    /** Id RecoltOS d'un save GatherOS importé (`items.origin_id`). */
    itemIdOf: (saveId: string) => number | undefined
    now?: () => number
    log?: (msg: string) => void
  },
): BoardsImportResult {
  const res: BoardsImportResult = { spaces: 0, nodes: 0, skipped: 0, existing: 0 }
  if (!hasTable(legacy, 'boards')) return res
  const hasOrder = (legacy.prepare('PRAGMA table_info(boards)').all() as { name: string }[]).some(
    (c) => c.name === 'order_index',
  )
  const boards = legacy
    .prepare(
      `SELECT id, name, created_at, updated_at, ${hasOrder ? 'COALESCE(order_index, 0)' : '0'} AS order_index
       FROM boards ORDER BY created_at`,
    )
    .all() as BoardRow[]
  if (boards.length === 0) return res
  const items = hasTable(legacy, 'board_items')
    ? (legacy
        .prepare('SELECT * FROM board_items ORDER BY board_id, z_index')
        .all() as BoardItemRow[])
    : []
  const now = opts.now ?? Date.now
  const byBoard = new Map<string, BoardItemRow[]>()
  for (const it of items) {
    const l = byBoard.get(it.board_id) ?? []
    l.push(it)
    byBoard.set(it.board_id, l)
  }
  lib.db.transaction(() => {
    for (const b of boards) {
      const exists = lib.db
        .prepare("SELECT id FROM spaces WHERE origin = 'gatheros' AND origin_id = ?")
        .get(b.id)
      if (exists) {
        res.existing++
        continue
      }
      const created = b.created_at ?? now()
      const s = lib.repos.spaces.create(
        { name: b.name ?? '', origin: 'gatheros', originId: b.id },
        created,
      )
      lib.db
        .prepare('UPDATE spaces SET order_index = ?, updated_at = ? WHERE id = ?')
        .run(b.order_index ?? 0, b.updated_at ?? created, s.id)
      res.spaces++
      const nodes: SpaceNodeInput[] = []
      for (const it of byBoard.get(b.id) ?? []) {
        const type = (it.type ?? '').toLowerCase()
        const data = parseData(it.data)
        const ref = saveRef(type, data)
        const itemId = ref ? opts.itemIdOf(ref) : undefined
        const kind =
          itemId !== undefined
            ? 'item'
            : type === 'note' || type === 'sticky'
              ? 'note'
              : type === 'shape' || type === 'rect' || type === 'ellipse'
                ? 'shape'
                : type === 'text'
                  ? 'text'
                  : null
        if (!kind || it.x === null || it.y === null) {
          res.skipped++
          opts.log?.(`[import] board ${b.id} : élément ${it.id} (${type || '?'}) ignoré`)
          continue
        }
        const def = DEFAULTS[kind]!
        const width = Math.max(MIN_NODE_SIZE, it.width ?? def.width)
        const height = Math.max(MIN_NODE_SIZE, it.height ?? def.height)
        const content = str(data.text) ?? str(data.content) ?? ''
        const style =
          kind === 'item'
            ? defaultItemStyle()
            : kind === 'note'
              ? { ...defaultNoteStyle(), color: noteColor(data.color) }
              : kind === 'shape'
                ? defaultShapeStyle(
                    (str(data.shape) ?? str(data.kind) ?? type).includes('ellipse')
                      ? 'ellipse'
                      : 'rect',
                  )
                : { ...defaultTextStyle(), autoWidth: false }
        nodes.push({
          uuid: newUuid(),
          type: kind,
          itemId: kind === 'item' ? itemId : null,
          x: it.x,
          y: it.y,
          width,
          height,
          rotation: normalizeRotation(it.rotation ?? 0),
          z: it.z_index ?? 0,
          content: kind === 'item' ? null : content.slice(0, 20_000),
          style,
        })
      }
      if (nodes.length > 0) {
        lib.repos.spaces.upsertNodes(s.id, nodes, b.updated_at ?? created)
        lib.db
          .prepare('UPDATE spaces SET updated_at = ? WHERE id = ?')
          .run(b.updated_at ?? created, s.id)
      }
      res.nodes += nodes.length
    }
  })()
  return res
}
