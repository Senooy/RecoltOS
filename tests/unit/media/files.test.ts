/**
 * WP-03 — opérations fichier : hash en flux, clonage FICLONE + rename, zip (yazl), toPng.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cloneFile, hashFile, safeZipName, zipLibrary } from '../../../src/main/workers/media/files'
import { makeTmp, sha256 } from './helpers'

const tmp = makeTmp()
afterAll(() => tmp.cleanup())

describe('hashFile', () => {
  it('sha256 et taille identiques à crypto', async () => {
    const p = join(tmp.dir, 'data.bin')
    const buf = Buffer.alloc(3 * 1024 * 1024 + 17)
    for (let i = 0; i < buf.length; i++) buf[i] = (i * 31) & 0xff
    writeFileSync(p, buf)
    expect(await hashFile({ abs: p })).toEqual({ sha256: sha256(p), bytes: buf.length })
  })

  it('fichier absent → not_found', async () => {
    await expect(hashFile({ abs: join(tmp.dir, 'absent') })).rejects.toMatchObject({
      code: 'not_found',
    })
  })
})

describe('cloneFile', () => {
  it('copie octet pour octet, crée les dossiers, sans temporaire résiduel', async () => {
    const src = join(tmp.dir, 'src.txt')
    writeFileSync(src, 'bonjour '.repeat(1000))
    const dst = join(tmp.dir, 'items', 'ab', 'clone.txt')
    expect(await cloneFile({ src, dst })).toEqual({ bytes: statSync(src).size })
    expect(readFileSync(dst)).toEqual(readFileSync(src))
    expect(readdirSync(join(tmp.dir, 'items', 'ab'))).toEqual(['clone.txt'])
  })

  it('source absente → not_found ; même chemin → validation', async () => {
    await expect(
      cloneFile({ src: join(tmp.dir, 'absent'), dst: join(tmp.dir, 'x', 'y') }),
    ).rejects.toMatchObject({ code: 'not_found' })
    const src = join(tmp.dir, 'src.txt')
    await expect(cloneFile({ src, dst: src })).rejects.toMatchObject({ code: 'validation' })
  })
})

describe('zipLibrary', () => {
  it('archive lisible par unzip, progression, médias stockés sans recompression', async () => {
    const root = join(tmp.dir, 'lib')
    mkdirSync(join(root, 'items', 'ab'), { recursive: true })
    writeFileSync(join(root, 'library.db'), 'x'.repeat(5000))
    writeFileSync(join(root, 'items', 'ab', 'a.jpg'), Buffer.alloc(2000, 7))
    const out = join(tmp.dir, 'export', 'lib.zip')
    const progress: { done: number; total: number }[] = []
    const r = await zipLibrary(
      {
        root,
        out,
        entries: [
          { abs: join(root, 'library.db'), name: 'library.db' },
          { abs: 'items/ab/a.jpg', name: 'items/ab/a.jpg' },
        ],
      },
      (p) => progress.push(p),
    )
    expect(r.bytes).toBe(statSync(out).size)
    expect(progress.at(-1)).toEqual({ done: 2, total: 2 })
    const listing = execFileSync('/usr/bin/unzip', ['-v', out], { encoding: 'utf8' })
    expect(listing).toMatch(/Stored.*items\/ab\/a\.jpg/)
    expect(listing).toMatch(/Defl.*library\.db/)
    execFileSync('/usr/bin/unzip', ['-tq', out])
    expect(readdirSync(join(tmp.dir, 'export'))).toEqual(['lib.zip'])
  })

  it('noms dangereux refusés, rien n’est écrit', async () => {
    for (const bad of ['../x', '/abs', 'a/../b', 'a//b', 'a\\b', '', './a']) {
      expect(() => safeZipName(bad)).toThrow()
    }
    const out = join(tmp.dir, 'bad', 'bad.zip')
    await expect(
      zipLibrary({
        root: tmp.dir,
        out,
        entries: [{ abs: join(tmp.dir, 'src.txt'), name: '../evil' }],
      }),
    ).rejects.toMatchObject({ code: 'validation' })
    await expect(
      zipLibrary({
        root: tmp.dir,
        out,
        entries: [
          { abs: join(tmp.dir, 'src.txt'), name: 'a' },
          { abs: join(tmp.dir, 'src.txt'), name: 'a' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'validation' })
    await expect(
      zipLibrary({ root: tmp.dir, out, entries: [{ abs: join(tmp.dir, 'nope'), name: 'n' }] }),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(readdirSync(join(tmp.dir, 'bad'))).toEqual([])
  })
})
