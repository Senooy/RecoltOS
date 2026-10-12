/**
 * dépôt Spaces sur une vraie base (cascade, SET NULL, atomicité, CHECK, plafonds,
 * sous-lots de 3 000 nœuds, viewport sans `updated_at`, duplication, « Ajouter à un space »).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '../../../src/shared/errors'
import { SpaceDoc, SpaceSummary } from '../../../src/shared/dto/spaces'
import { defaultItemStyle } from '../../../src/shared/spaces-defaults'
import { FLUSH_CHUNK, type SpaceNode } from '../../../src/shared/spaces-schema'
import {
  addItems,
  applyBatch,
  asSpacesError,
  createSpace,
  deleteSpace,
  duplicateSpace,
  getSpace,
  listSpaces,
  renameSpace,
} from '../../../src/main/spaces/repo'
import { makeSpacesLib, note, type SpacesLib } from './helpers'

let h: SpacesLib | null = null
afterEach(() => {
  h?.cleanup()
  h = null
})

const batch = (spaceUuid: string, upsert: SpaceNode[] = [], del: string[] = []) => ({
  spaceUuid,
  upsert,
  delete: del,
})

function item(h: SpacesLib, kind: 'image' | 'tweet' = 'image') {
  const it = h.lib.repos.items.insert({ kind, title: 'élément' })
  if (kind === 'image') {
    h.lib.repos.media.insert(it.id, {
      mediaType: 'image',
      status: 'ok',
      fileRel: `items/aa/${it.uuid}.jpg`,
      mime: 'image/jpeg',
      width: 1600,
      height: 900,
    })
  }
  return it
}

describe('spaces : dépôt', () => {
  it('create / get / list : document vide, aperçu, nodeCount', () => {
    h = makeSpacesLib()
    const { uuid } = createSpace(h.lib, 'Moodboard', 1000)
    const doc = getSpace(h.lib, uuid)
    expect(SpaceDoc.parse(doc).space.name).toBe('Moodboard')
    expect(doc.nodes).toEqual([])
    applyBatch(h.lib, batch(uuid, [note(), note({ x: 300 })]))
    const list = listSpaces(h.lib)
    expect(list).toHaveLength(1)
    expect(SpaceSummary.parse(list[0]).nodeCount).toBe(2)
    expect(list[0]!.preview.nodes).toHaveLength(2)
  })

  it('cascade spaces → space_nodes ; ON DELETE SET NULL sur item_id', () => {
    h = makeSpacesLib()
    const { uuid } = createSpace(h.lib)
    const it1 = item(h)
    const n: SpaceNode = {
      ...note(),
      type: 'item',
      itemUuid: it1.uuid,
      style: defaultItemStyle(),
    }
    applyBatch(h.lib, batch(uuid, [n]))
    let doc = getSpace(h.lib, uuid)
    expect(doc.nodes[0]).toMatchObject({ type: 'item', itemUuid: it1.uuid })
    expect(Object.keys(doc.items)).toEqual([it1.uuid])
    h.lib.db.prepare('DELETE FROM items WHERE id = ?').run(it1.id)
    doc = getSpace(h.lib, uuid)
    expect(doc.nodes[0]).toMatchObject({ type: 'item', itemUuid: null })
    deleteSpace(h.lib, uuid)
    expect((h.lib.db.prepare('SELECT count(*) n FROM space_nodes').get() as { n: number }).n).toBe(
      0,
    )
  })

  it('item inconnu → itemUuid null (« Élément supprimé »)', () => {
    h = makeSpacesLib()
    const { uuid } = createSpace(h.lib)
    const n = {
      ...note(),
      type: 'item',
      itemUuid: '99999999-9999-4999-8999-999999999999',
      style: defaultItemStyle(),
    } as SpaceNode
    applyBatch(h.lib, batch(uuid, [n]))
    expect(getSpace(h.lib, uuid).nodes[0]).toMatchObject({ itemUuid: null })
  })

  it('applyBatch atomique : une ligne invalide (width < 24) annule tout, code validation', () => {
    h = makeSpacesLib()
    const { uuid } = createSpace(h.lib)
    const good = note()
    const bad = note({ width: 10 })
    let err: unknown
    try {
      applyBatch(h.lib, batch(uuid, [good, bad]))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('validation')
    expect(getSpace(h.lib, uuid).nodes).toHaveLength(0)
  })

  it('codes : validation ≠ busy ≠ io (non réessayable vs réessayable)', () => {
    expect(
      asSpacesError(Object.assign(new Error('x'), { code: 'SQLITE_CONSTRAINT_CHECK' })).code,
    ).toBe('validation')
    expect(asSpacesError(Object.assign(new Error('x'), { code: 'SQLITE_BUSY' })).code).toBe('busy')
    expect(asSpacesError(Object.assign(new Error('x'), { code: 'SQLITE_IOERR_WRITE' })).code).toBe(
      'io',
    )
  })

  it('3 000 nœuds en sous-lots, déplacés puis relus sans perte ; suppression', () => {
    h = makeSpacesLib()
    const { uuid } = createSpace(h.lib)
    const nodes = Array.from({ length: 3000 }, (_, i) =>
      note({ x: i * 10, y: (i % 50) * 10, z: i }),
    )
    for (let i = 0; i < nodes.length; i += FLUSH_CHUNK) {
      applyBatch(h.lib, batch(uuid, nodes.slice(i, i + FLUSH_CHUNK)))
    }
    const moved = nodes.map((n) => ({ ...n, x: n.x + 7, y: n.y - 3 }))
    for (let i = 0; i < moved.length; i += FLUSH_CHUNK) {
      applyBatch(h.lib, batch(uuid, moved.slice(i, i + FLUSH_CHUNK)))
    }
    const doc = getSpace(h.lib, uuid)
    expect(doc.nodes).toHaveLength(3000)
    const byId = new Map(doc.nodes.map((n) => [n.uuid, n]))
    for (const n of moved) expect(byId.get(n.uuid)).toMatchObject({ x: n.x, y: n.y })
    applyBatch(
      h.lib,
      batch(
        uuid,
        [],
        moved.slice(0, 1000).map((n) => n.uuid),
      ),
    )
    expect(getSpace(h.lib, uuid).nodes).toHaveLength(2000)
  })

  it('viewport sans toucher updated_at ; nom et fond le touchent', () => {
    h = makeSpacesLib()
    const { uuid } = createSpace(h.lib, 'A', 1000)
    const r1 = applyBatch(
      h.lib,
      { ...batch(uuid), viewport: { x: 10, y: 20, zoom: 2 } },
      { now: 5000 },
    )
    expect(r1.updatedAt).toBe(1000)
    expect(getSpace(h.lib, uuid).space.viewport).toEqual({ x: 10, y: 20, zoom: 2 })
    const r2 = applyBatch(h.lib, { ...batch(uuid), name: 'B', background: 'grid' }, { now: 6000 })
    expect(r2.updatedAt).toBe(6000)
    renameSpace(h.lib, uuid, 'C', 7000)
    expect(getSpace(h.lib, uuid).space).toMatchObject({
      name: 'C',
      background: 'grid',
      updatedAt: 7000,
    })
  })

  it('plafond de 20 000 nœuds : limit_exceeded, rien écrit', () => {
    h = makeSpacesLib()
    const { uuid } = createSpace(h.lib)
    // On abaisse artificiellement le plafond en pré-remplissant au plus près.
    const fill = Array.from({ length: 19_999 }, (_, i) => note({ x: i }))
    for (let i = 0; i < fill.length; i += 5000)
      applyBatch(h.lib, batch(uuid, fill.slice(i, i + 5000)))
    expect(() => applyBatch(h!.lib, batch(uuid, [note(), note()]))).toThrow(
      expect.objectContaining({ code: 'limit_exceeded' }) as Error,
    )
    expect(getSpace(h.lib, uuid).nodes).toHaveLength(19_999)
  })

  it('space inconnu → not_found', () => {
    h = makeSpacesLib()
    expect(() => getSpace(h!.lib, '99999999-9999-4999-8999-999999999999')).toThrow(
      expect.objectContaining({ code: 'not_found' }) as Error,
    )
  })

  it('duplication : nouveaux uuid, mêmes contenus', () => {
    h = makeSpacesLib()
    const { uuid } = createSpace(h.lib, 'Source')
    applyBatch(h.lib, batch(uuid, [note({ content: 'a' }), note({ content: 'b', x: 400 })]))
    const copy = duplicateSpace(h.lib, uuid)
    const a = getSpace(h.lib, uuid)
    const b = getSpace(h.lib, copy.uuid)
    expect(b.space.name).toBe('Source (copie)')
    expect(b.nodes.map((n) => (n.type === 'note' ? n.content : ''))).toEqual(['a', 'b'])
    expect(b.nodes.some((n) => a.nodes.some((m) => m.uuid === n.uuid))).toBe(false)
  })

  it('addItems : grille à droite du contenu (x = maxX + 80, y = minY), liste rafraîchie', () => {
    h = makeSpacesLib()
    const { uuid } = createSpace(h.lib)
    applyBatch(h.lib, batch(uuid, [note({ x: 100, y: 50, width: 200, height: 200 })]))
    const items = [item(h), item(h), item(h, 'tweet')]
    const r = addItems(
      h.lib,
      uuid,
      items.map((i) => i.uuid),
    )
    expect(r.added).toBe(3)
    const doc = getSpace(h.lib, uuid)
    const added = doc.nodes.filter((n) => n.type === 'item')
    expect(added).toHaveLength(3)
    expect(Math.min(...added.map((n) => n.x))).toBe(100 + 200 + 80)
    expect(Math.min(...added.map((n) => n.y))).toBe(50)
    // L'aperçu de la liste reflète l'ajout sans ouvrir l'éditeur.
    expect(listSpaces(h.lib)[0]!.preview.nodes.filter((n) => n.type === 'item')).toHaveLength(3)
    // Espace vide : à l'origine.
    const empty = createSpace(h.lib)
    addItems(h.lib, empty.uuid, [items[0]!.uuid])
    expect(getSpace(h.lib, empty.uuid).nodes[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    })
  })
})
