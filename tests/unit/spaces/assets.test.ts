/**
 * Spaces assets (copy by fingerprint, magic bytes, HEIC/TIFF → displayable by
 * sips, thumbnails), garbage collection (orphans only), internal clipboard format, import
 * of GatherOS boards (rows with NULL width/height/rotation).
 */
import Database from 'better-sqlite3'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  importAssetBuffer,
  importAssetFile,
  importAssetFiles,
} from '../../../src/main/spaces/assets'
import { decodeNodesHtml, encodeNodesHtml } from '../../../src/main/spaces/clipboard-format'
import { gcSpaceAssets } from '../../../src/main/spaces/gc'
import { importGatherosBoards } from '../../../src/main/spaces/migrate-gatheros'
import { applyBatch, createSpace, getSpace, listSpaces } from '../../../src/main/spaces/repo'
import { defaultImageStyle } from '../../../src/shared/spaces-defaults'
import type { SpaceNode } from '../../../src/shared/spaces-schema'
import { generateMediaFixtures, HAS_SIPS, type MediaFixtures } from '../../fixtures/media/generate'
import { writeImage } from '../../helpers/synthetic-media'
import { makeHarness, type JobsHarness } from '../jobs/helpers'
import { makeTmp } from '../media/helpers'
import { nodeUuid } from './helpers'

let fx: MediaFixtures
let tmp: { dir: string; cleanup(): void }
beforeAll(async () => {
  tmp = makeTmp('recolt-spaces-assets-')
  fx = await generateMediaFixtures(join(tmp.dir, 'fx'))
}, 120_000)
afterAll(() => tmp.cleanup())

let h: JobsHarness | null = null
afterEach(async () => {
  await h?.cleanup()
  h = null
})

const deps = (hh: JobsHarness, keepOriginals = false) => ({
  lib: hh.lib,
  media: hh.services.media,
  keepOriginals,
})

describe('spaces assets', () => {
  it('copy by fingerprint, idempotent, webp thumbnail, original intact', async () => {
    h = makeHarness()
    const src = join(tmp.dir, 'photo.png')
    await writeImage(src, { width: 1200, height: 600, format: 'png' })
    const before = readFileSync(src)
    const a = await importAssetFile(deps(h), src)
    expect(a.assetRel).toMatch(/^spaces\/assets\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/)
    expect(a).toMatchObject({
      kind: 'image',
      mime: 'image/png',
      naturalWidth: 1200,
      naturalHeight: 600,
    })
    expect(a.assetUrl.startsWith('recolt://ltest/spaces/assets/')).toBe(true)
    expect(a.thumbUrl).toMatch(/\.thumb\.webp$/)
    expect(readFileSync(src).equals(before)).toBe(true)
    const b = await importAssetFile(deps(h), src)
    expect(b.assetRel).toBe(a.assetRel)
    const shardDir = join(h.lib.root, 'spaces/assets', a.assetRel.split('/')[2]!)
    expect(readdirSync(shardDir).sort()).toHaveLength(2)
  })

  it('type by magic bytes: a .png that is text is refused; folder refused', async () => {
    h = makeHarness()
    const fake = join(tmp.dir, 'faux.png')
    writeFileSync(fake, 'pas une image du tout')
    await expect(importAssetFile(deps(h), fake)).rejects.toMatchObject({ code: 'unsupported' })
    await expect(importAssetFile(deps(h), tmp.dir)).rejects.toMatchObject({ code: 'validation' })
    const r = await importAssetFiles(deps(h), [fake, join(tmp.dir, 'absent.png')])
    expect(r.assets).toHaveLength(0)
    expect(r.failed).toHaveLength(2)
  })

  it.runIf(HAS_SIPS)(
    'TIFF → displayable PNG; HEIC → JPEG; original only if keepOriginals',
    async () => {
      h = makeHarness()
      const t = await importAssetFile(deps(h), fx.tiff)
      expect(t.assetRel).toMatch(/\.png$/)
      expect(t.mime).toBe('image/png')
      expect(readFileSync(join(h.lib.root, t.assetRel)).subarray(1, 4).toString()).toBe('PNG')
      const shard = join(h.lib.root, 'spaces/assets', t.assetRel.split('/')[2]!)
      expect(readdirSync(shard).some((f) => f.includes('.orig.'))).toBe(false)
      if (fx.heic) {
        const k = await importAssetFile(deps(h, true), fx.heic)
        expect(k.assetRel).toMatch(/\.jpg$/)
        expect(k.mime).toBe('image/jpeg')
        const dir = join(h.lib.root, 'spaces/assets', k.assetRel.split('/')[2]!)
        expect(readdirSync(dir).some((f) => /\.orig\.hei[cf]$/.test(f))).toBe(true)
      }
    },
  )

  it('clipboard bytes → asset; temporary file removed', async () => {
    h = makeHarness()
    const src = join(tmp.dir, 'clip.png')
    await writeImage(src, { width: 64, height: 64, format: 'png' })
    const a = await importAssetBuffer(deps(h), new Uint8Array(readFileSync(src)))
    expect(a.kind).toBe('image')
    expect(readdirSync(join(h.lib.root, 'tmp/spaces'))).toEqual([])
  })

  it('GC: only removes orphan assets (derived files included)', async () => {
    h = makeHarness()
    const p1 = join(tmp.dir, 'g1.png')
    const p2 = join(tmp.dir, 'g2.png')
    await writeImage(p1, { width: 80, height: 40, format: 'png', color: '#112233' })
    await writeImage(p2, { width: 80, height: 40, format: 'png', color: '#445566' })
    const a1 = await importAssetFile(deps(h), p1)
    const a2 = await importAssetFile(deps(h), p2)
    const { uuid } = createSpace(h.lib)
    const node: SpaceNode = {
      uuid: nodeUuid(),
      type: 'image',
      x: 0,
      y: 0,
      width: 80,
      height: 40,
      rotation: 0,
      z: 0,
      locked: false,
      createdAt: 1,
      updatedAt: 1,
      assetRel: a1.assetRel,
      style: defaultImageStyle({
        mime: a1.mime,
        naturalWidth: 80,
        naturalHeight: 40,
        kind: 'image',
      }),
    }
    applyBatch(h.lib, { spaceUuid: uuid, upsert: [node], delete: [] })
    const r = await gcSpaceAssets(h.lib)
    expect(r.removed).toBe(2) // asset 2 + its thumbnail
    expect(existsSync(join(h.lib.root, a1.assetRel))).toBe(true)
    expect(existsSync(join(h.lib.root, a2.assetRel))).toBe(false)
    const doc = getSpace(h.lib, uuid)
    expect(doc.nodes[0]).toMatchObject({ type: 'image', assetRel: a1.assetRel })
    expect((doc.nodes[0] as { assetThumbUrl?: string }).assetThumbUrl).toMatch(/\.thumb\.webp$/)
  })
})

describe('internal clipboard', () => {
  it('round trip of the marked HTML; text escaped; foreign HTML ignored', () => {
    const json = JSON.stringify([{ uuid: 'x', content: 'é <b>&' }])
    const html = encodeNodesHtml(json, 'a <script> & "b"')
    expect(html).toContain('a &lt;script&gt; &amp; &quot;b&quot;')
    expect(decodeNodesHtml(html)).toBe(json)
    expect(decodeNodesHtml('<p>https://exemple.fr</p>')).toBeNull()
    expect(decodeNodesHtml('<span data-recolt-nodes="!!!" data-recolt-v="1">')).toBeNull()
  })
})

describe('GatherOS boards import', () => {
  it('fixture with NULL width/height/rotation: imported without error, skipped logged, idempotent', () => {
    const hh = makeHarness()
    h = hh
    const legacy = new Database(':memory:')
    legacy.exec(readFileSync(join(__dirname, '../../fixtures/gatheros/legacy-schema.sql'), 'utf8'))
    const it = hh.lib.repos.items.insert({ kind: 'image', origin: 'gatheros', originId: 'save-1' })
    legacy
      .prepare(
        'INSERT INTO boards (id, name, created_at, updated_at, order_index) VALUES (?, ?, ?, ?, ?)',
      )
      .run('b1', 'Board', 1000, 2000, null)
    const ins = legacy.prepare(
      `INSERT INTO board_items (id, board_id, type, x, y, width, height, rotation, z_index, data, created_at, updated_at)
       VALUES (?, 'b1', ?, ?, ?, ?, ?, ?, ?, ?, 1000, 1000)`,
    )
    ins.run(
      'i1',
      'note',
      10,
      20,
      null,
      null,
      null,
      0,
      JSON.stringify({ text: 'Bonjour', color: 'pink' }),
    )
    ins.run('i2', 'image', 0, 0, 12, 5000, 400, 1, JSON.stringify({ saveId: 'save-1' }))
    ins.run('i3', 'shape', 5, 5, 100, null, 30, 2, JSON.stringify({ shape: 'ellipse' }))
    ins.run('i4', 'image', 0, 0, 100, 100, 0, 3, JSON.stringify({ path: '/inconnu.png' }))
    ins.run('i5', 'mystere', 0, 0, 100, 100, 0, 4, '{}')
    const logs: string[] = []
    const r = importGatherosBoards(legacy, hh.lib, {
      itemIdOf: (id) => (id === 'save-1' ? it.id : undefined),
      log: (m) => logs.push(m),
    })
    expect(r).toMatchObject({ spaces: 1, nodes: 3, skipped: 2 })
    expect(logs).toHaveLength(2)
    const s = listSpaces(hh.lib)[0]!
    expect(s).toMatchObject({ name: 'Board', updatedAt: 2000 })
    const doc = getSpace(hh.lib, s.uuid)
    const n = doc.nodes.find((x) => x.type === 'note')!
    expect(n).toMatchObject({
      width: 200,
      height: 200,
      content: 'Bonjour',
      style: { color: 'pink' },
    })
    expect(doc.nodes.find((x) => x.type === 'item')).toMatchObject({
      width: 24,
      height: 5000,
      rotation: 40,
      itemUuid: it.uuid,
    })
    expect(doc.nodes.find((x) => x.type === 'shape')).toMatchObject({
      height: 120,
      rotation: 30,
      style: { kind: 'ellipse' },
    })
    expect(importGatherosBoards(legacy, hh.lib, { itemIdOf: () => undefined })).toMatchObject({
      spaces: 0,
      existing: 1,
    })
    legacy.close()
  })
})
