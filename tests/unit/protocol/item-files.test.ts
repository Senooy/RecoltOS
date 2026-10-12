/**
 * Files of an item (`system.*` handlers, drag) on a real migrated database:
 * cover original, poster of a video for the copy, remote media ignored.
 */
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRepos } from '../../../src/main/db/repos'
import { libraryPaths } from '../../../src/main/library/paths'
import {
  copyImageSource,
  dragFiles,
  itemOriginals,
  requireCoverOriginal,
} from '../../../src/main/protocol/item-files'
import { openTestDb, type TestDb } from '../../helpers/db'
import { makeTmpDir } from '../../helpers/tmpdir'

let db: TestDb
let lib: { repos: ReturnType<typeof createRepos>; paths: ReturnType<typeof libraryPaths> }
const ids: Record<string, string> = {}

function touch(rel: string): void {
  const abs = join(lib.paths.root, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, 'x')
}

beforeAll(() => {
  const root = makeTmpDir('recolt-item-files-')
  db = openTestDb()
  lib = { repos: createRepos(db), paths: libraryPaths(root) }
  const r = lib.repos.items

  ids.image = r.insertWithMedia({ kind: 'image', title: 'Photo' }, [
    {
      mediaType: 'image',
      uuid: '11111111-1111-4111-8111-111111111111',
      fileRel: 'items/11/11111111-1111-4111-8111-111111111111.webp',
      thumbRel: 'thumbs/11/11111111-1111-4111-8111-111111111111.webp',
    },
  ]).uuid
  touch('items/11/11111111-1111-4111-8111-111111111111.webp')
  touch('thumbs/11/11111111-1111-4111-8111-111111111111.webp')

  ids.video = r.insertWithMedia({ kind: 'video' }, [
    {
      mediaType: 'video',
      uuid: '22222222-2222-4222-8222-222222222222',
      fileRel: 'items/22/22222222-2222-4222-8222-222222222222.mp4',
      posterRel: 'posters/22/22222222-2222-4222-8222-222222222222.jpg',
    },
  ]).uuid
  touch('items/22/22222222-2222-4222-8222-222222222222.mp4')
  touch('posters/22/22222222-2222-4222-8222-222222222222.jpg')

  ids.carousel = r.insertWithMedia({ kind: 'tweet', source: 'x' }, [
    {
      mediaType: 'image',
      uuid: '33333333-3333-4333-8333-333333333331',
      fileRel: 'items/33/33333333-3333-4333-8333-333333333331.jpg',
    },
    {
      mediaType: 'image',
      uuid: '33333333-3333-4333-8333-333333333332',
      status: 'remote',
      fileRel: null,
      remoteUrl: 'https://pbs.example/x.jpg',
    },
    {
      mediaType: 'image',
      uuid: '33333333-3333-4333-8333-333333333333',
      fileRel: 'items/33/33333333-3333-4333-8333-333333333333.png',
    },
  ]).uuid
  touch('items/33/33333333-3333-4333-8333-333333333331.jpg')
  touch('items/33/33333333-3333-4333-8333-333333333333.png')

  ids.textOnly = r.insertWithMedia({ kind: 'tweet', source: 'x' }, []).uuid
  ids.lost = r.insertWithMedia({ kind: 'image' }, [
    {
      mediaType: 'image',
      uuid: '44444444-4444-4444-8444-444444444444',
      fileRel: 'items/44/44444444-4444-4444-8444-444444444444.jpg',
    },
  ]).uuid
})

afterAll(() => db.close())

describe('item-files', () => {
  it('cover original (absolute path in the library)', () => {
    expect(requireCoverOriginal(lib, ids.image!)).toBe(
      join(lib.paths.root, 'items/11/11111111-1111-4111-8111-111111111111.webp'),
    )
  })

  it('carousel: local originals in order, remote media ignored', () => {
    expect(itemOriginals(lib, ids.carousel!).map((p) => p.slice(lib.paths.root.length))).toEqual([
      '/items/33/33333333-3333-4333-8333-333333333331.jpg',
      '/items/33/33333333-3333-4333-8333-333333333333.png',
    ])
  })

  it('text post, lost file or unknown uuid → not_found', () => {
    expect(() => requireCoverOriginal(lib, ids.textOnly!)).toThrow(
      expect.objectContaining({ code: 'not_found' }),
    )
    expect(() => requireCoverOriginal(lib, ids.lost!)).toThrow(
      expect.objectContaining({ code: 'not_found' }),
    )
    expect(() => requireCoverOriginal(lib, '99999999-9999-4999-8999-999999999999')).toThrow(
      expect.objectContaining({ code: 'not_found' }),
    )
  })

  it('image copy: original for an image, poster for a video', () => {
    expect(copyImageSource(lib, ids.image!)).toMatch(/items\/11\/.*\.webp$/)
    expect(copyImageSource(lib, ids.video!)).toMatch(/posters\/22\/.*\.jpg$/)
    expect(() => copyImageSource(lib, ids.textOnly!)).toThrow(
      expect.objectContaining({ code: 'not_found' }),
    )
  })

  it('image copy: video without poster or thumbnail → inherited thumbnail', () => {
    const uuid = '55555555-5555-4555-8555-555555555555'
    const id = lib.repos.items.insertWithMedia({ kind: 'video' }, [
      {
        mediaType: 'video',
        uuid,
        fileRel: `items/55/${uuid}.mp4`,
        legacyThumbRel: `legacy/55/${uuid}.jpg`,
      },
    ]).uuid
    touch(`items/55/${uuid}.mp4`)
    touch(`legacy/55/${uuid}.jpg`)
    expect(copyImageSource(lib, id)).toBe(join(lib.paths.root, `legacy/55/${uuid}.jpg`))
  })

  it('drag and itemOriginals: a symbolic link leaving the library is ignored', () => {
    const outside = makeTmpDir('recolt-outside-')
    const uuid = '66666666-6666-4666-8666-666666666666'
    const rel = `items/66/${uuid}.jpg`
    mkdirSync(dirname(join(lib.paths.root, rel)), { recursive: true })
    writeFileSync(join(outside, 'secret.jpg'), 'x')
    symlinkSync(join(outside, 'secret.jpg'), join(lib.paths.root, rel))
    const id = lib.repos.items.insertWithMedia({ kind: 'image' }, [
      { mediaType: 'image', uuid, fileRel: rel },
    ]).uuid
    expect(itemOriginals(lib, id)).toEqual([])
    expect(() => requireCoverOriginal(lib, id)).toThrow(
      expect.objectContaining({ code: 'not_found' }),
    )
  })

  it('drag: originals of the selection, unknown and text posts ignored', () => {
    const files = dragFiles(lib, [
      ids.video!,
      ids.textOnly!,
      '99999999-9999-4999-8999-999999999999',
      ids.image!,
      ids.video!,
    ])
    expect(files.map((f) => f.split('/').slice(-2).join('/'))).toEqual([
      '22/22222222-2222-4222-8222-222222222222.mp4',
      '11/11111111-1111-4111-8111-111111111111.webp',
    ])
  })
})
