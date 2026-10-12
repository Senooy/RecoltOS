import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  quarantine,
  writeFileAtomic,
  writeJsonAtomic,
} from '../../../src/main/library/atomic-write'
import {
  defaultLibraryRoot,
  libraryPaths,
  rel,
  resolveInside,
  userDataPaths,
} from '../../../src/main/library/paths'

const U = 'ab12cd34-0000-4000-8000-000000000001'

describe('paths', () => {
  it('canonical relative paths', () => {
    expect(rel.original(U, '.JPG')).toBe(`items/ab/${U}.jpg`)
    expect(rel.thumb(U)).toBe(`thumbs/ab/${U}.webp`)
    expect(rel.large(U)).toBe(`large/ab/${U}.webp`)
    expect(rel.poster(U)).toBe(`posters/ab/${U}.jpg`)
    expect(rel.preview(U)).toBe(`previews/ab/${U}.mp4`)
    expect(rel.display(U)).toBe(`display/ab/${U}.webp`)
    const k = createHash('sha1').update('ada').digest('hex').slice(0, 16)
    expect(rel.avatar('x', '@Ada')).toBe(`avatars/x/${k}.jpg`)
    const u = createHash('sha1').update('https://e.test/a.png').digest('hex')
    expect(rel.remote('https://e.test/a.png', 'png')).toBe(`remote/${u}.png`)
    expect(rel.spaceAsset('ABCDEF', 'png')).toBe('spaces/assets/ab/ABCDEF.png')
    expect(rel.spaceAssetThumb('ABCDEF')).toBe('spaces/assets/ab/ABCDEF.thumb.jpg')
    expect(rel.tmp('x.part')).toBe('tmp/x.part')
    expect(() => rel.original(U, 'j/pg')).toThrow(/extension/)
  })

  it('libraryPaths and resolution confined to the root', () => {
    const p = libraryPaths('/lib/root/')
    expect(p).toMatchObject({
      root: '/lib/root',
      db: '/lib/root/recolt.db',
      wal: '/lib/root/recolt.db-wal',
      shm: '/lib/root/recolt.db-shm',
    })
    expect(p.dir('thumbs')).toBe('/lib/root/thumbs')
    expect(p.abs(`items/ab/${U}.jpg`)).toBe(`/lib/root/items/ab/${U}.jpg`)
    for (const bad of [
      '',
      '/etc/passwd',
      '../x',
      'items/../../x',
      'items//x',
      'a\\b',
      'a\0b',
      './x',
    ]) {
      expect(() => resolveInside('/lib/root', bad), bad).toThrow()
    }
  })

  it('userData', () => {
    const u = userDataPaths('/u')
    expect(u).toMatchObject({
      prefs: '/u/prefs.json',
      libraries: '/u/libraries.json',
      windowState: '/u/window-state.json',
      librariesDir: '/u/libraries',
      aiSandbox: '/u/ai-sandbox',
      framesCache: '/u/cache/frames',
      inbox: '/u/inbox',
      hostJson: '/u/host.json',
    })
    expect(defaultLibraryRoot('/u', 'default')).toBe('/u/libraries/default')
  })
})

describe('atomic write', () => {
  it('writes, replaces, leaves no .tmp; quarantine', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recolt-atomic-'))
    const f = path.join(dir, 'sub', 'a.json')
    writeJsonAtomic(f, { a: 1 })
    writeFileAtomic(f, 'B')
    expect(fs.readFileSync(f, 'utf8')).toBe('B')
    expect(fs.existsSync(`${f}.tmp`)).toBe(false)
    expect((fs.statSync(f).mode & 0o777).toString(8)).toBe('600')
    expect(quarantine(f, 42)).toBe(`${f}.bad-42`)
    expect(quarantine(f, 43)).toBeNull()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
