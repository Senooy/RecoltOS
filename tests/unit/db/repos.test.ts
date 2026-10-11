import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nameKey, UNTITLED_NAME_KEY } from '../../../src/main/db/repos/items'
import { normalizeHandle } from '../../../src/main/db/repos/authors'
import { syncSourceKey } from '../../../src/main/db/repos/sync'
import { membershipKey } from '../../../src/main/db/repos/tombstones'
import { JOB_PRIORITY } from '../../../src/shared/jobs'
import { isReservedTagName, normalizeTagName } from '../../../src/main/db/repos/tags'
import { chunks, fromJson, toBool, toJson } from '../../../src/main/db/repos/util'
import { z } from 'zod'
import { openTestLib, T0, uuidN, type TestLib } from './helpers'

let lib: TestLib
beforeEach(() => {
  lib = openTestLib()
})
afterEach(() => lib.cleanup())

const tombs = () =>
  lib.db
    .prepare('SELECT entity, origin_id FROM import_tombstones ORDER BY entity, origin_id')
    .all() as { entity: string; origin_id: string }[]

describe('items', () => {
  it('insertWithMedia : couverture = position 0, media_count, une transaction', () => {
    const { items, media } = lib.repos
    const r = items.insertWithMedia({ kind: 'image', title: 'Carrousel', uuid: uuidN(1) }, [
      { mediaType: 'image', fileRel: 'items/00/a.jpg', width: 10, height: 20 },
      { mediaType: 'video', fileRel: 'items/00/b.mp4', hasAudio: true, isAnimated: false },
    ])
    expect(r.uuid).toBe(uuidN(1))
    const row = items.getById(r.id)!
    expect(row.media_count).toBe(2)
    expect(row.cover_media_id).toBe(r.mediaIds[0])
    expect(row.created_at).toBe(T0)
    expect(row.name_key).toBe('carrousel')
    const list = media.listByItem(r.id)
    expect(list.map((m) => [m.position, m.media_type, m.has_audio])).toEqual([
      [0, 'image', null],
      [1, 'video', 1],
    ])
    expect(items.getByUuid(uuidN(1))?.id).toBe(r.id)
    expect(items.insert({ kind: 'tweet' }).mediaIds).toEqual([])
    expect(items.getByUuid(items.insert({ kind: 'tweet' }).uuid)?.media_count).toBe(0)
  })

  it('insertWithMedia : un média invalide annule tout', () => {
    const { items } = lib.repos
    expect(() =>
      items.insertWithMedia({ kind: 'image' }, [
        { mediaType: 'image', position: 0 },
        { mediaType: 'image', position: 0 },
      ]),
    ).toThrow()
    expect(items.countAll()).toBe(0)
  })

  it('upsertByOrigin : created / existing / updated / tombstoned', () => {
    const { items } = lib.repos
    const input = { kind: 'image' as const, origin: 'gatheros', originId: 'g1', title: 'A' }
    const a = items.upsertByOrigin(input, [{ mediaType: 'image', fileRel: 'items/aa/x.jpg' }])
    expect(a.status).toBe('created')
    expect(items.upsertByOrigin({ ...input, title: 'B' })).toEqual({ ...a, status: 'existing' })
    expect(items.getById(a.id!)?.title).toBe('A')
    expect(
      items.upsertByOrigin({ ...input, title: 'B' }, [], { onExisting: 'update' }).status,
    ).toBe('updated')
    expect(items.getById(a.id!)?.title).toBe('B')
    expect(items.getByOrigin('gatheros', 'g1')?.name_key).toBe('b')
    items.purge([a.id!])
    expect(items.upsertByOrigin(input)).toEqual({ status: 'tombstoned', id: null, uuid: null })
    expect(items.upsertByOrigin(input, [], { respectTombstones: false }).status).toBe('created')
  })

  it('update : champs JSON, booléens, name_key, updated_at ; patch vide', () => {
    const { items } = lib.repos
    const id = items.insert({ kind: 'image' }).id
    expect(items.getById(id)?.name_key).toBe(UNTITLED_NAME_KEY)
    lib.clock.now = T0 + 5
    expect(
      items.update(id, {
        title: '  Élan  Vital ',
        palette: ['#ffffff'],
        paletteLab: [[100, 0, 0]],
        aiTags: ['a'],
        aiExcluded: true,
        colorBucket: 3,
      }),
    ).toBe(true)
    const row = items.getById(id)!
    expect(row).toMatchObject({
      title: '  Élan  Vital ',
      name_key: 'elan vital',
      palette: '["#ffffff"]',
      palette_lab: '[[100,0,0]]',
      ai_tags: '["a"]',
      ai_excluded: 1,
      color_bucket: 3,
      color_key: 3100,
      updated_at: T0 + 5,
    })
    items.update(id, { postMeta: null })
    expect(items.getById(id)?.post_meta).toBeNull()
    expect(items.update(id, { createdAt: 1 } as never)).toBe(true) // ignoré (non modifiable)
    expect(items.getById(id)?.created_at).toBe(T0)
    expect(items.update(9999, { title: 'x' })).toBe(false)
  })

  it('corbeille : sync_dismissed pour les sources synchronisées, restauration', () => {
    const { items, sync } = lib.repos
    const x = items.insert({ kind: 'tweet', source: 'x', externalId: '123' }).id
    const local = items.insert({ kind: 'image' }).id
    expect(items.trash([x, local])).toBe(2)
    expect(items.trash([x])).toBe(0)
    expect(items.getById(x)?.deleted_at).toBe(T0)
    expect(sync.isDismissed('x', '123')).toBe(true)
    expect(items.countLive()).toBe(0)
    expect(items.trashedBefore(T0 + 1)).toEqual([x, local])
    expect(items.trashedBefore(T0)).toEqual([])
    expect(items.restore([x])).toBe(1)
    expect(sync.isDismissed('x', '123')).toBe(false)
    expect(items.getById(x)?.deleted_at).toBeNull()
  })

  it('masquage et vues', () => {
    const { items } = lib.repos
    const id = items.insert({ kind: 'image' }).id
    expect(items.setHidden([id], true)).toBe(1)
    expect(items.setHidden([id], true)).toBe(0)
    expect(items.getById(id)?.hidden_at).toBe(T0)
    expect(items.setHidden([id], false)).toBe(1)
    expect(items.getById(id)?.hidden_at).toBeNull()
    items.markViewed(id, T0 + 7)
    items.markViewed(id, T0 + 8)
    expect(items.getById(id)).toMatchObject({ view_count: 2, viewed_at: T0 + 8 })
    expect(items.idsByUuids([items.getById(id)!.uuid, 'absent'])).toEqual(
      new Map([[items.getById(id)!.uuid, id]]),
    )
  })

  it('purge : fichiers + job purge.files dans la même transaction ; pierre tombale item', () => {
    const { items, collections, jobs } = lib.repos
    const g = items.insertWithMedia({ kind: 'video', origin: 'gatheros', originId: 'save-1' }, [
      {
        mediaType: 'video',
        fileRel: 'items/ab/u.mp4',
        thumbRel: 'thumbs/ab/u.webp',
        posterRel: 'posters/ab/u.jpg',
        previewRel: 'previews/ab/u.mp4',
        legacyThumbRel: 'thumbs/ab/u-legacy.jpg',
      },
    ]).id
    const c = collections.create({ name: 'C', origin: 'gatheros', originId: 'col-1' }).id
    collections.addItems(c, [g])
    const res = items.purge([g, 424242], 'trash')
    expect(res.purged).toBe(1)
    expect(res.files).toEqual([
      'items/ab/u.mp4',
      'posters/ab/u.jpg',
      'previews/ab/u.mp4',
      'thumbs/ab/u-legacy.jpg',
      'thumbs/ab/u.webp',
    ])
    const job = jobs.get(res.jobId!)!
    expect(job).toMatchObject({ type: 'purge.files', itemId: null, priority: 10, state: 'queued' })
    expect(job.payload).toMatchObject({ mode: 'trash', files: res.files, failedOn: [] })
    expect(lib.db.prepare('SELECT count(*) AS n FROM item_media').get()).toEqual({ n: 0 })
    expect(lib.db.prepare('SELECT count(*) AS n FROM collection_items').get()).toEqual({ n: 0 })
    // Cascade : la pierre tombale de l'item suffit, pas d'appartenance fantôme.
    expect(tombs()).toEqual([{ entity: 'item', origin_id: 'save-1' }])
    expect(items.purge([])).toEqual({ purged: 0, files: [], jobId: null })
    const noFiles = items.insert({ kind: 'tweet' }).id
    expect(items.purge([noFiles]).jobId).toBeNull()
  })

  it('purge transactionnelle : un échec d’insertion du job annule la suppression', () => {
    const { items } = lib.repos
    const id = items.insertWithMedia({ kind: 'image' }, [{ mediaType: 'image', fileRel: 'f' }]).id
    lib.db.exec("CREATE TRIGGER boom BEFORE INSERT ON jobs BEGIN SELECT RAISE(ABORT, 'boom'); END;")
    expect(() => items.purge([id])).toThrow(/boom/)
    expect(items.getById(id)).toBeDefined()
  })

  it('nameKey', () => {
    expect(nameKey(null)).toBe(UNTITLED_NAME_KEY)
    expect(nameKey('   ')).toBe(UNTITLED_NAME_KEY)
    expect(nameKey('Ça  Va\tBien')).toBe('ca va bien')
  })
})

describe('media', () => {
  it('ajout, mise à jour, suppression : media_count et couverture suivent', () => {
    const { items, media } = lib.repos
    const r = items.insertWithMedia({ kind: 'image' }, [{ mediaType: 'image' }])
    const second = media.insert(r.id, { mediaType: 'image', contentHash: 'h1' })
    expect(media.getById(second.id)?.position).toBe(1)
    expect(items.getById(r.id)?.media_count).toBe(2)
    expect(media.update(second.id, { thumbRel: 'thumbs/x.webp', isAnimated: true })).toBe(true)
    expect(media.update(second.id, {})).toBe(false)
    expect(media.getByUuid(second.uuid)).toMatchObject({
      thumb_rel: 'thumbs/x.webp',
      is_animated: 1,
    })
    expect(media.findByHash('h1').map((m) => m.id)).toEqual([second.id])
    expect(media.delete(r.mediaIds[0]!)).toBe(true)
    expect(media.delete(r.mediaIds[0]!)).toBe(false)
    expect(items.getById(r.id)).toMatchObject({ media_count: 1, cover_media_id: second.id })
    expect(media.setStatus(second.id, 'missing')).toBe(true)
    expect(media.listByStatus('missing').map((m) => m.id)).toEqual([second.id])
    items.trash([r.id])
    expect(media.findByHash('h1')).toEqual([])
  })

  it('upsertByUuid idempotent', () => {
    const { items, media } = lib.repos
    const id = items.insert({ kind: 'image' }).id
    const a = media.upsertByUuid(id, { uuid: 'IMG_1.jpg', mediaType: 'image' })
    expect(a.created).toBe(true)
    expect(media.upsertByUuid(id, { uuid: 'IMG_1.jpg', mediaType: 'video' })).toEqual({
      id: a.id,
      created: false,
    })
    expect(items.getById(id)).toMatchObject({ media_count: 1, cover_media_id: a.id })
  })
})

describe('authors', () => {
  it('upsert par (plateforme, handle) insensible à la casse ; avatar', () => {
    const { authors } = lib.repos
    const id = authors.upsert({
      platform: 'x',
      handle: '@Ada',
      name: 'Ada',
      avatarUrl: 'https://a/1',
    })
    expect(authors.upsert({ platform: 'x', handle: 'ada', name: null })).toBe(id)
    expect(authors.getById(id)).toMatchObject({
      name: 'Ada',
      avatar_url: 'https://a/1',
      avatar_status: 'none',
    })
    expect(authors.needingAvatar().map((a) => a.id)).toEqual([id])
    authors.setAvatar(id, 'ok', 'avatars/x/abc.jpg', T0 + 1)
    // Nouvelle URL alors que l'avatar est valide : on garde « ok ».
    authors.upsert({ platform: 'x', handle: 'ADA', avatarUrl: 'https://a/2' })
    expect(authors.getByHandle('x', '@ada')).toMatchObject({
      avatar_status: 'ok',
      avatar_url: 'https://a/2',
    })
    authors.setAvatar(id, 'expired', null)
    expect(authors.getById(id)?.avatar_rel).toBe('avatars/x/abc.jpg')
    authors.upsert({
      platform: 'x',
      handle: 'ada',
      avatarUrl: 'https://a/3',
      sampleExternalId: '9',
    })
    expect(authors.getById(id)).toMatchObject({ avatar_status: 'none', sample_external_id: '9' })
    expect(authors.upsert({ platform: 'instagram', handle: 'ada' })).not.toBe(id)
    expect(() => authors.upsert({ platform: 'x', handle: ' @ ' })).toThrow()
    expect(normalizeHandle(' @@bob ')).toBe('bob')
  })
})

describe('collections', () => {
  it('création, ordre des frères, parent inexistant', () => {
    const { collections } = lib.repos
    const a = collections.create({ name: 'A' })
    const b = collections.create({ name: 'B' })
    expect(collections.getById(a.id)).toMatchObject({
      order_index: 1,
      color: '#007aff',
      parent_id: null,
    })
    expect(collections.getById(b.id)?.order_index).toBe(2)
    expect(collections.idByUuid(b.uuid)).toBe(b.id)
    expect(collections.getByUuid(a.uuid)?.name).toBe('A')
    expect(() => collections.create({ name: 'X', parentId: 999 })).toThrow(
      expect.objectContaining({ code: 'not_found' }),
    )
  })

  it('refus de cycle par CTE (soi-même, descendant) ; déplacement valide', () => {
    const { collections } = lib.repos
    const a = collections.create({ name: 'A' }).id
    const b = collections.create({ name: 'B', parentId: a }).id
    const c = collections.create({ name: 'C', parentId: b }).id
    const d = collections.create({ name: 'D' }).id
    const cycle = expect.objectContaining({ code: 'collection_cycle' }) as Error
    expect(() => collections.setParent(a, a)).toThrow(cycle)
    expect(() => collections.setParent(a, c)).toThrow(cycle)
    expect(() => collections.update(a, { parentId: b })).toThrow(cycle)
    expect(collections.getById(a)?.parent_id).toBeNull()
    expect(collections.descendantIds(a)).toEqual([b, c])
    expect(collections.setParent(c, d)).toBe(true)
    expect(collections.setParent(a, c)).toBe(true) // c n'est plus sous a
    expect(collections.setParent(a, null)).toBe(true)
    expect(collections.children(d).map((x) => x.id)).toEqual([c])
    expect(collections.update(a, {})).toBe(false)
    expect(() => collections.update(999, { name: 'x' })).toThrow(
      expect.objectContaining({ code: 'not_found' }),
    )
    expect(collections.update(a, { name: 'A2', color: '#ff0000', aiExcluded: true })).toBe(true)
    expect(collections.getById(a)).toMatchObject({ name: 'A2', color: '#ff0000', ai_excluded: 1 })
  })

  it('suppression avec descendants : pierres tombales de tous (gatheros)', () => {
    const { collections, items } = lib.repos
    const p = collections.create({ name: 'P', origin: 'gatheros', originId: 'cP' }).id
    const k = collections.create({ name: 'K', parentId: p, origin: 'gatheros', originId: 'cK' }).id
    const g = collections.create({ name: 'G', parentId: k, origin: 'gatheros', originId: 'cG' }).id
    collections.create({ name: 'local', parentId: g })
    const other = collections.create({ name: 'O', origin: 'gatheros', originId: 'cO' }).id
    const item = items.insert({ kind: 'image', origin: 'gatheros', originId: 's1' }).id
    collections.addItems(g, [item])
    expect(collections.delete(p)).toBe(4)
    expect(tombs()).toEqual([
      { entity: 'collection', origin_id: 'cG' },
      { entity: 'collection', origin_id: 'cK' },
      { entity: 'collection', origin_id: 'cP' },
    ])
    expect(lib.db.prepare('SELECT id FROM collections').all()).toEqual([{ id: other }])
    expect(items.getById(item)).toBeDefined()
    expect(
      collections.upsertByOrigin({ name: 'K', origin: 'gatheros', originId: 'cK' }).status,
    ).toBe('tombstoned')
    expect(() => collections.delete(p)).toThrow(expect.objectContaining({ code: 'not_found' }))
  })

  it('suppression keepChildren : les enfants remontent', () => {
    const { collections } = lib.repos
    const root = collections.create({ name: 'R' }).id
    const p = collections.create({ name: 'P', parentId: root }).id
    const k = collections.create({ name: 'K', parentId: p }).id
    expect(collections.delete(p, { keepChildren: true })).toBe(1)
    expect(collections.getById(k)?.parent_id).toBe(root)
  })

  it('appartenances : ajout idempotent, retrait → pierre tombale membership, déplacement', () => {
    const { collections, items } = lib.repos
    const c = collections.create({ name: 'C', origin: 'gatheros', originId: 'col' }).id
    const c2 = collections.create({ name: 'C2' }).id
    const g = items.insert({ kind: 'image', origin: 'gatheros', originId: 'save' }).id
    const local = items.insert({ kind: 'image' }).id
    expect(collections.addItems(c, [g, local, g])).toBe(2)
    expect(collections.addItems(c, [g])).toBe(0)
    expect(collections.itemIds(c)).toEqual([g, local])
    expect(collections.removeItems(c, [g, local])).toBe(2)
    expect(tombs()).toEqual([{ entity: 'membership', origin_id: membershipKey('col', 'save') }])
    collections.addItems(c, [local])
    expect(collections.moveItems(c, c2, [local])).toBe(1)
    expect(collections.itemIds(c)).toEqual([])
    expect(collections.itemIds(c2)).toEqual([local])
    expect(() => collections.addItems(999, [local])).toThrow()
    // Déplacement vers la même collection, membre gatheros vivant : aucune pierre tombale posée.
    const c3 = collections.create({ name: 'C3', origin: 'gatheros', originId: 'col3' }).id
    const g3 = items.insert({ kind: 'image', origin: 'gatheros', originId: 'save3' }).id
    collections.addItems(c3, [g3])
    const tombsBefore = tombs()
    expect(collections.moveItems(c3, c3, [g3])).toBe(0)
    expect(collections.itemIds(c3)).toEqual([g3])
    expect(tombs()).toEqual(tombsBefore)
    expect(tombs()).not.toContainEqual({
      entity: 'membership',
      origin_id: membershipKey('col3', 'save3'),
    })
  })

  it('upsertByOrigin et markViewed', () => {
    const { collections } = lib.repos
    const a = collections.upsertByOrigin({ name: 'A', origin: 'gatheros', originId: 'x' })
    expect(a.status).toBe('created')
    expect(collections.upsertByOrigin({ name: 'Z', origin: 'gatheros', originId: 'x' })).toEqual({
      ...a,
      status: 'existing',
    })
    expect(collections.markViewed(a.id!, 5)).toBe(true)
    expect(collections.getById(a.id!)?.viewed_at).toBe(5)
  })

  it('réordonnancement : avant un frère, en dernier, renumérotation', () => {
    const { collections } = lib.repos
    const [a, b, c] = ['A', 'B', 'C'].map((name) => collections.create({ name }).id) as [
      number,
      number,
      number,
    ]
    const order = () => collections.children(null).map((x) => x.name)
    collections.reorder(c, a)
    expect(order()).toEqual(['C', 'A', 'B'])
    collections.reorder(c, null)
    expect(order()).toEqual(['A', 'B', 'C'])
    collections.reorder(c, b)
    expect(order()).toEqual(['A', 'C', 'B'])
    for (let i = 0; i < 40; i++) {
      collections.reorder(b, c)
      collections.reorder(c, b)
    }
    expect(order()).toEqual(['A', 'C', 'B'])
    expect(() => collections.reorder(a, 999)).toThrow(
      expect.objectContaining({ code: 'not_found' }),
    )
  })
})

describe('tags', () => {
  it('normalisation et noms réservés', () => {
    expect(normalizeTagName('  #Belle  Image ')).toBe('belle-image')
    expect(normalizeTagName('Café')).toBe('café')
    expect(() => normalizeTagName(' # ')).toThrow(expect.objectContaining({ code: 'validation' }))
    expect(() => normalizeTagName('x'.repeat(65))).toThrow(/trop long/)
    expect(isReservedTagName('bookmark')).toBe(true)
    const { tags, items } = lib.repos
    const id = items.insert({ kind: 'image' }).id
    for (const name of ['x', '#Instagram', 'COSMOS', 'bookmark']) {
      expect(() => tags.addToItems([id], [name])).toThrow(
        expect.objectContaining({ code: 'tag_reserved' }),
      )
    }
    expect(tags.ensure('cosmos', { allowReserved: true }).created).toBe(true)
  })

  it('ajout, retrait, renommage (conflit), fusion, suppression, comptes', () => {
    const { tags, items } = lib.repos
    const a = items.insert({ kind: 'image' }).id
    const b = items.insert({ kind: 'image' }).id
    const [chat, chien] = tags.addToItems([a, b], ['Chat', 'chien', 'CHAT'], 'ai') as [
      number,
      number,
    ]
    expect(tags.ensure('chat')).toMatchObject({ id: chat, created: false })
    expect(tags.namesOfItem(a)).toEqual(['chat', 'chien'])
    expect(() => tags.rename(chat, 'Chien')).toThrow(expect.objectContaining({ code: 'conflict' }))
    expect(() => tags.rename(999, 'z')).toThrow(expect.objectContaining({ code: 'not_found' }))
    expect(tags.rename(chat, 'Félin').name).toBe('félin')
    expect(tags.getByName('FÉLIN')?.id).toBe(chat)
    items.trash([b])
    expect(tags.listWithCounts().map((t) => [t.name, t.count])).toEqual([
      ['chien', 1],
      ['félin', 1],
    ])
    const solo = tags.addToItems([b], ['solo'])[0]!
    expect(tags.merge([chien, solo, chat], chat)).toBe(2)
    expect(tags.namesOfItem(b)).toEqual(['félin'])
    expect(() => tags.merge([chat], 999)).toThrow(expect.objectContaining({ code: 'not_found' }))
    expect(tags.setColor(chat, '#123456')).toBe(true)
    expect(tags.getById(chat)?.color).toBe('#123456')
    expect(tags.getByUuid(tags.getById(chat)!.uuid)?.id).toBe(chat)
    expect(tags.removeFromItems([a], [chat])).toBe(1)
    expect(tags.delete(chat)).toBe(true)
    expect(tags.delete(chat)).toBe(false)
  })
})

describe('jobs', () => {
  it('dédoublonnage actif, priorité DESC, claim, retry, échec, ménage', () => {
    const { jobs, items } = lib.repos
    const item = items.insert({ kind: 'image' }).id
    const low = jobs.enqueue({
      type: 'media.derive',
      itemId: item,
      dedupeKey: 'media:1',
      priority: 10,
    })
    expect(jobs.enqueue({ type: 'media.derive', dedupeKey: 'media:1', priority: 50 })).toBe(low)
    expect(jobs.get(low)?.priority).toBe(50)
    expect(jobs.enqueue({ type: 'media.derive', dedupeKey: 'media:1', priority: 5 })).toBe(low)
    expect(jobs.get(low)?.priority).toBe(50)
    const urgent = jobs.enqueue({ type: 'media.derive', priority: 100 })
    const later = jobs.enqueue({ type: 'media.derive', priority: 100, runAfter: T0 + 1000 })
    jobs.enqueue({ type: 'avatar.fetch', payload: { authorId: 3 } })

    const first = jobs.claimNext('media.derive')!
    expect(first).toMatchObject({ id: urgent, state: 'running', attempts: 1 })
    expect(jobs.claimNext('media.derive')?.id).toBe(low)
    expect(jobs.claimNext('media.derive')).toBeNull()
    expect(jobs.claimNext('media.derive', T0 + 1000)?.id).toBe(later)
    expect(jobs.countsByType()['media.derive']).toEqual({ queued: 0, running: 3, failed: 0 })

    // Un job terminé libère la clé de dédoublonnage.
    jobs.complete(low)
    expect(jobs.enqueue({ type: 'media.derive', itemId: item, dedupeKey: 'media:1' })).not.toBe(low)

    jobs.retry(urgent, T0 + 60_000, { code: 'io', message: 'x' }, { refundAttempt: true })
    expect(jobs.getRow(urgent)).toMatchObject({
      state: 'queued',
      attempts: 0,
      run_after: T0 + 60_000,
    })
    expect(JSON.parse(jobs.getRow(urgent)!.last_error!)).toEqual({ code: 'io', message: 'x' })
    jobs.retry(urgent, 0, null)
    expect(jobs.getRow(urgent)?.last_error).toBeNull()
    jobs.fail(later, { code: 'http_404', message: 'introuvable' })
    expect(jobs.get(later)?.state).toBe('failed')
    expect(jobs.requeueFailed('media.derive')).toBe(1)
    expect(jobs.get(later)).toMatchObject({ state: 'queued', attempts: 0 })

    jobs.claimNext('avatar.fetch')
    expect(jobs.resetRunning()).toBe(1)
    expect(jobs.cancelForItem(item)).toBe(1)
    expect(jobs.cleanup(T0 + 1)).toBe(2)
    expect(jobs.cleanup(T0)).toBe(0)
    expect(jobs.get(424242)).toBeNull()
    expect(() => jobs.enqueue({ type: 'embed.item' as never })).toThrow(/CHECK/)
  })

  it('requeueFailed : ne viole pas ux_jobs_active quand la clé est déjà active ou en double', () => {
    const { jobs } = lib.repos
    const fail = (id: number) => {
      jobs.claimNext('media.derive')
      jobs.fail(id, { code: 'io', message: 'x' })
    }
    const a = jobs.enqueue({ type: 'media.derive', dedupeKey: 'item:1' })
    fail(a)
    const b = jobs.enqueue({ type: 'media.derive', dedupeKey: 'item:1' })
    expect(b).not.toBe(a)
    expect(jobs.requeueFailed('media.derive')).toBe(0)
    expect(jobs.get(a)?.state).toBe('cancelled')
    expect(jobs.get(b)?.state).toBe('queued')

    // Deux `failed` de même clé : seul le plus récent est relancé.
    jobs.claimNext('media.derive')
    jobs.fail(b, { code: 'io', message: 'x' })
    const c = jobs.enqueue({ type: 'media.derive', dedupeKey: 'item:1' })
    fail(c)
    const lone = jobs.enqueue({ type: 'media.derive', dedupeKey: 'item:2' })
    fail(lone)
    const nokey = jobs.enqueue({ type: 'media.derive' })
    fail(nokey)
    expect(jobs.requeueFailed()).toBe(3)
    expect(jobs.get(b)?.state).toBe('cancelled')
    expect(jobs.get(c)?.state).toBe('queued')
    expect(jobs.get(lone)?.state).toBe('queued')
    expect(jobs.get(nokey)?.state).toBe('queued')
  })

  it('charge utile illisible → failedOn vide', () => {
    const { jobs } = lib.repos
    const id = jobs.enqueue({ type: 'remote.fetch', payload: { url: 'u', failedOn: ['cdn1'] } })
    expect(jobs.get(id)?.payload).toEqual({ url: 'u', failedOn: ['cdn1'] })
    lib.db.prepare("UPDATE jobs SET payload = '[1]' WHERE id = ?").run(id)
    expect(jobs.get(id)?.payload).toEqual({ failedOn: [] })
  })
})

describe('settings', () => {
  it('JSON, validation, préfixes', () => {
    const { settings } = lib.repos
    expect(settings.get('absent')).toBeUndefined()
    settings.set('jobs.paused', { 'ai.enrich': { until: null, reason: 'x' } })
    settings.set('view.current', 'library')
    settings.set('view.current', 'collections')
    expect(settings.get('view.current')).toBe('collections')
    expect(settings.getParsed('view.current', z.enum(['library', 'collections']), 'library')).toBe(
      'collections',
    )
    expect(settings.getParsed('view.current', z.number(), 3)).toBe(3)
    expect(settings.getParsed('absent', z.number(), 4)).toBe(4)
    expect(settings.keys('view.')).toEqual(['view.current'])
    expect(settings.keys()).toEqual(['jobs.paused', 'view.current'])
    expect(() => settings.set('k', undefined)).toThrow()
    expect(settings.delete('view.current')).toBe(true)
    expect(settings.delete('view.current')).toBe(false)
  })
})

describe('sync', () => {
  it('état, éléments connus, rejetés, journal', () => {
    const { sync, items } = lib.repos
    expect(sync.getState('x')).toMatchObject({ enabled: 0, status: 'idle', budget_used: 0 })
    expect(sync.patchState('x', { enabled: true, status: 'ok', totalSynced: 4 })).toMatchObject({
      enabled: 1,
      status: 'ok',
      total_synced: 4,
    })
    expect(sync.patchState('x', {}).status).toBe('ok')
    const item = items.insert({ kind: 'tweet', source: 'x' }).id
    sync.upsertItem({ source: 'instagram', externalId: 'abc', itemId: item })
    sync.upsertItem({ source: 'instagram', externalId: 'abc', accountId: 'me' }, T0 + 9)
    expect(lib.db.prepare('SELECT * FROM sync_items').get()).toMatchObject({
      source_key: 'ig:abc',
      item_id: item,
      account_id: 'me',
      last_seen_at: T0 + 9,
    })
    expect(sync.knownExternalIds('instagram', ['abc', 'zzz'])).toEqual(new Set(['abc']))
    expect(syncSourceKey('x', '1')).toBe('x:1')
    expect(sync.dismiss('cosmos', '7')).toBe(true)
    expect(sync.dismiss('cosmos', '7')).toBe(false)
    expect(sync.undismiss('cosmos', '7')).toBe(true)
    sync.startRun({ id: 'r1', source: 'x', mode: 'incremental', reason: 'manual' })
    expect(sync.finishRun('r1', { status: 'ok', newItems: 2 }, T0 + 50)).toBe(true)
    expect(sync.listRuns('x')).toEqual([
      expect.objectContaining({ id: 'r1', status: 'ok', new_items: 2, finished_at: T0 + 50 }),
    ])
  })
})

describe('spaces', () => {
  it('création, nœuds (upsert, suppression), cascade, item purgé', () => {
    const { spaces, items } = lib.repos
    const s = spaces.create({ name: 'Moodboard' })
    const item = items.insert({ kind: 'image' }).id
    expect(
      spaces.upsertNodes(s.id, [
        { uuid: uuidN(1), type: 'item', itemId: item, x: 0, y: 0, width: 100, height: 100 },
        {
          uuid: uuidN(2),
          type: 'note',
          x: 5,
          y: 5,
          width: 50,
          height: 50,
          content: 'hé',
          style: { color: 'yellow' },
          z: 2,
        },
      ]),
    ).toBe(2)
    spaces.upsertNodes(s.id, [{ uuid: uuidN(2), type: 'note', x: 9, y: 9, width: 60, height: 60 }])
    expect(spaces.listNodes(s.id).map((n) => [n.uuid, n.x, n.z])).toEqual([
      [uuidN(1), 0, 0],
      [uuidN(2), 9, 0],
    ])
    expect(() =>
      spaces.upsertNodes(s.id, [
        { uuid: uuidN(3), type: 'shape', x: 0, y: 0, width: 10, height: 10 },
      ]),
    ).toThrow(/CHECK/)
    items.purge([item])
    expect(spaces.listNodes(s.id)[0]?.item_id).toBeNull()
    expect(
      spaces.update(s.id, {
        name: 'Renommé',
        viewport: { x: 1, y: 2, zoom: 3 },
        background: 'grid',
      }),
    ).toBe(true)
    expect(spaces.getByUuid(s.uuid)).toMatchObject({
      name: 'Renommé',
      background: 'grid',
      viewport: '{"x":1,"y":2,"zoom":3}',
    })
    expect(spaces.deleteNodes(s.id, [uuidN(1)])).toBe(1)
    const other = spaces.create({}, T0 + 1)
    expect(spaces.list().map((x) => x.id)).toEqual([other.id, s.id])
    expect(spaces.softDelete(other.id)).toBe(true)
    expect(spaces.list().map((x) => x.id)).toEqual([s.id])
    expect(spaces.delete(s.id)).toBe(true)
    expect(lib.db.prepare('SELECT count(*) AS n FROM space_nodes').get()).toEqual({ n: 0 })
  })
})

describe('tombstones', () => {
  it('ajout, présence, ensemble, retrait, effacement', () => {
    const { tombstones } = lib.repos
    expect(tombstones.add('gatheros', 'item', 'a')).toBe(true)
    expect(tombstones.add('gatheros', 'item', 'a')).toBe(false)
    tombstones.add('gatheros', 'membership', 'c:a')
    expect(tombstones.has('gatheros', 'item', 'a')).toBe(true)
    expect(tombstones.ids('gatheros', 'item')).toEqual(new Set(['a']))
    expect(tombstones.count('gatheros')).toBe(2)
    expect(tombstones.count('gatheros', 'membership')).toBe(1)
    expect(tombstones.remove('gatheros', 'item', 'a')).toBe(true)
    expect(tombstones.clear('gatheros')).toBe(1)
  })
})

describe('util', () => {
  it('JSON, booléens, tranches', () => {
    expect(toJson(undefined)).toBeNull()
    expect(fromJson('{')).toBeNull()
    expect(fromJson(null)).toBeNull()
    expect(fromJson<number[]>('[1]')).toEqual([1])
    expect(toBool(undefined)).toBeNull()
    expect(toBool(false)).toBe(0)
    expect(chunks([1, 2, 3], 2)).toEqual([[1, 2], [3]])
  })
})

describe('intégrité après un scénario complet', () => {
  it('foreign_keys = 1, integrity_check = ok, foreign_key_check vide', () => {
    const { items, collections, tags } = lib.repos
    const a = items.insertWithMedia({ kind: 'image' }, [{ mediaType: 'image' }]).id
    const c = collections.create({ name: 'C' }).id
    collections.addItems(c, [a])
    tags.addToItems([a], ['t'])
    collections.update(c, { coverItemId: a })
    items.purge([a])
    expect(collections.getById(c)?.cover_item_id).toBeNull()
    expect(lib.db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(lib.db.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(lib.db.pragma('foreign_key_check')).toEqual([])
  })
})

describe('renumérotation et erreurs de validation', () => {
  it('renumérotation : tous les frères repositionnés reçoivent updated_at', () => {
    const { collections } = lib.repos
    const [a, b, c] = ['A', 'B', 'C'].map((name) => collections.create({ name }).id) as [
      number,
      number,
      number,
    ]
    // Écart trop faible entre A et B : `reorder` doit renuméroter les frères.
    lib.db.prepare('UPDATE collections SET order_index = ? WHERE id = ?').run(1, a)
    lib.db.prepare('UPDATE collections SET order_index = ? WHERE id = ?').run(1 + 1e-7, b)
    lib.db.prepare('UPDATE collections SET order_index = ? WHERE id = ?').run(3, c)
    lib.clock.now = T0 + 777
    collections.reorder(c, b)
    expect(collections.children(null).map((x) => x.name)).toEqual(['A', 'C', 'B'])
    for (const id of [a, b, c]) expect(collections.getById(id)?.updated_at).toBe(T0 + 777)
  })

  it('authors.upsert et settings.set lèvent une AppError validation', () => {
    expect(() => lib.repos.authors.upsert({ platform: 'x', handle: ' @ ' })).toThrow(
      expect.objectContaining({ code: 'validation' }),
    )
    expect(() => lib.repos.settings.set('k', undefined)).toThrow(
      expect.objectContaining({ code: 'validation' }),
    )
  })

  it('jobs.enqueue sans priorité : JOB_PRIORITY.BACKGROUND', () => {
    const id = lib.repos.jobs.enqueue({ type: 'media.derive' })
    expect(lib.repos.jobs.get(id)?.priority).toBe(JOB_PRIORITY.BACKGROUND)
  })
})
