/**
 * file operations: streaming hash, FICLONE cloning + rename, zip (yazl), toPng.
 */
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cloneFile, hashFile, safeZipName, zipLibrary } from '../../../src/main/workers/media/files'
import { makeTmp, sha256 } from './helpers'

const tmp = makeTmp()
afterAll(() => tmp.cleanup())

describe('hashFile', () => {
  it('sha256 and size identical to crypto', async () => {
    const p = join(tmp.dir, 'data.bin')
    const buf = Buffer.alloc(3 * 1024 * 1024 + 17)
    for (let i = 0; i < buf.length; i++) buf[i] = (i * 31) & 0xff
    writeFileSync(p, buf)
    expect(await hashFile({ abs: p })).toEqual({ sha256: sha256(p), bytes: buf.length })
  })

  it('missing file → not_found', async () => {
    await expect(hashFile({ abs: join(tmp.dir, 'absent') })).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('access denied → io, French message, Node message only in details', async () => {
    if (process.getuid?.() === 0) return // root reads everything: no EACCES to produce
    const p = join(tmp.dir, 'no-read.bin')
    writeFileSync(p, 'x')
    chmodSync(p, 0o000)
    try {
      const err = await hashFile({ abs: p }).catch((e: unknown) => e)
      expect(err).toMatchObject({ code: 'io', message: `accès refusé : ${p}` })
      expect((err as { details: { code?: string } }).details.code).toBe('EACCES')
    } finally {
      chmodSync(p, 0o644)
    }
  })
})

describe('cloneFile', () => {
  it('byte-for-byte copy, creates folders, no leftover temp file', async () => {
    const src = join(tmp.dir, 'src.txt')
    writeFileSync(src, 'bonjour '.repeat(1000))
    const dst = join(tmp.dir, 'items', 'ab', 'clone.txt')
    expect(await cloneFile({ src, dst })).toEqual({ bytes: statSync(src).size })
    expect(readFileSync(dst)).toEqual(readFileSync(src))
    expect(readdirSync(join(tmp.dir, 'items', 'ab'))).toEqual(['clone.txt'])
  })

  it('missing source → not_found; same path → validation', async () => {
    await expect(
      cloneFile({ src: join(tmp.dir, 'absent'), dst: join(tmp.dir, 'x', 'y') }),
    ).rejects.toMatchObject({ code: 'not_found' })
    const src = join(tmp.dir, 'src.txt')
    await expect(cloneFile({ src, dst: src })).rejects.toMatchObject({ code: 'validation' })
  })

  it('same file under another spelling (/./, //, link) → validation, original intact', async () => {
    const dir = join(tmp.dir, 'same-clone')
    mkdirSync(dir, { recursive: true })
    const src = join(dir, 'orig.txt')
    writeFileSync(src, 'précieux')
    symlinkSync(src, join(dir, 'alias.txt'))
    for (const dst of [`${dir}/./orig.txt`, `${dir}//orig.txt`, join(dir, 'alias.txt')]) {
      await expect(cloneFile({ src, dst })).rejects.toMatchObject({ code: 'validation' })
    }
    expect(readFileSync(src, 'utf8')).toBe('précieux')
    expect(readdirSync(dir).sort()).toEqual(['alias.txt', 'orig.txt'])
  })
})

describe('zipLibrary', () => {
  it('archive readable by unzip, progress, media stored without recompression', async () => {
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

  it('dangerous names rejected, nothing is written', async () => {
    for (const bad of ['../x', '/abs', 'a/../b', 'a//b', 'a\\b', '', './a']) {
      expect(() => safeZipName(bad)).toThrow()
    }
    const badRoot = join(tmp.dir, 'bad-root')
    mkdirSync(badRoot, { recursive: true })
    const out = join(tmp.dir, 'bad', 'bad.zip')
    await expect(
      zipLibrary({
        root: badRoot,
        out,
        entries: [{ abs: join(tmp.dir, 'src.txt'), name: '../evil' }],
      }),
    ).rejects.toMatchObject({ code: 'validation' })
    await expect(
      zipLibrary({
        root: badRoot,
        out,
        entries: [
          { abs: join(tmp.dir, 'src.txt'), name: 'a' },
          { abs: join(tmp.dir, 'src.txt'), name: 'a' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'validation' })
    await expect(
      zipLibrary({ root: badRoot, out, entries: [{ abs: join(tmp.dir, 'nope'), name: 'n' }] }),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(readdirSync(join(tmp.dir, 'bad'))).toEqual([])
  })

  it('relative path leaving the library rejected; symbolic link rejected', async () => {
    const root = join(tmp.dir, 'confine')
    mkdirSync(join(root, 'items'), { recursive: true })
    writeFileSync(join(root, 'items', 'ok.bin'), 'ok')
    writeFileSync(join(tmp.dir, 'outside.bin'), 'secret')
    const out = join(tmp.dir, 'confine-out', 'c.zip')
    for (const abs of ['../outside.bin', 'items/../../outside.bin', '.', '']) {
      await expect(zipLibrary({ root, out, entries: [{ abs, name: 'x' }] })).rejects.toMatchObject({
        code: 'validation',
      })
    }
    symlinkSync(join(tmp.dir, 'outside.bin'), join(root, 'items', 'link.bin'))
    await expect(
      zipLibrary({ root, out, entries: [{ abs: 'items/link.bin', name: 'link.bin' }] }),
    ).rejects.toMatchObject({ code: 'validation' })
    await expect(
      zipLibrary({
        root,
        out,
        entries: [{ abs: join(root, 'items', 'link.bin'), name: 'link.bin' }],
      }),
    ).rejects.toMatchObject({ code: 'validation' })
    expect(readdirSync(join(tmp.dir, 'confine-out'))).toEqual([])
    // A relative path under the root is still accepted.
    const ok = await zipLibrary({
      root,
      out,
      entries: [{ abs: 'items/ok.bin', name: 'items/ok.bin' }],
    })
    expect(ok.bytes).toBeGreaterThan(0)
  })

  it('symbolic intermediate folder leaving the root → validation, nothing is written', async () => {
    const root = join(tmp.dir, 'dirlink-root')
    mkdirSync(join(root, 'items'), { recursive: true })
    const outside = join(tmp.dir, 'dirlink-outside')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'hosts'), 'hors racine')
    symlinkSync(outside, join(root, 'etclink'))
    // A symbolic folder that stays within the root is still accepted.
    symlinkSync(join(root, 'items'), join(root, 'alias'))
    writeFileSync(join(root, 'items', 'ok.bin'), 'ok')
    const out = join(tmp.dir, 'dirlink-out', 'd.zip')
    const err = await zipLibrary({
      root,
      out,
      entries: [{ abs: 'etclink/hosts', name: 'hosts' }],
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'validation' })
    expect((err as Error).message).toMatch(/hors de la bibliothèque/)
    expect(existsSync(out)).toBe(false)
    const ok = await zipLibrary({
      root,
      out,
      entries: [{ abs: 'alias/ok.bin', name: 'alias/ok.bin' }],
    })
    expect(ok.bytes).toBeGreaterThan(0)
  })

  it('null entry → validation (not internal); names differing only by case → validation', async () => {
    const root = join(tmp.dir, 'entries-root')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'f.txt'), 'f')
    const out = join(tmp.dir, 'entries-out', 'e.zip')
    await expect(
      zipLibrary({ root, out, entries: [null as unknown as { abs: string; name: string }] }),
    ).rejects.toMatchObject({ code: 'validation' })
    await expect(
      zipLibrary({
        root,
        out,
        entries: [
          { abs: 'f.txt', name: 'A.txt' },
          { abs: 'f.txt', name: 'a.txt' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'validation' })
    expect(existsSync(out)).toBe(false)
  })

  it('output inside the library, or output = source (hard link included) → validation, source intact', async () => {
    const root = join(tmp.dir, 'out-root')
    mkdirSync(join(root, 'items'), { recursive: true })
    const a = join(root, 'items', 'a.txt')
    writeFileSync(a, 'précieux')
    const entries = [{ abs: 'items/a.txt', name: 'items/a.txt' }]
    await expect(zipLibrary({ root, out: a, entries })).rejects.toMatchObject({
      code: 'validation',
    })
    await expect(zipLibrary({ root, out: join(root, 'lib.zip'), entries })).rejects.toMatchObject({
      code: 'validation',
    })
    const ext = join(tmp.dir, 'out-ext.txt')
    writeFileSync(ext, 'x')
    const hardlink = join(tmp.dir, 'out-hardlink.zip')
    linkSync(ext, hardlink)
    await expect(
      zipLibrary({ root, out: hardlink, entries: [{ abs: ext, name: 'x' }] }),
    ).rejects.toMatchObject({ code: 'validation' })
    expect(readFileSync(a, 'utf8')).toBe('précieux')
    expect(readFileSync(ext, 'utf8')).toBe('x')
  })

  describe('source modified or deleted during export', () => {
    function setup(tag: string) {
      const root = join(tmp.dir, `live-${tag}`)
      mkdirSync(root, { recursive: true })
      writeFileSync(join(root, 'a.bin'), Buffer.alloc(256 * 1024, 1))
      writeFileSync(join(root, 'b.bin'), Buffer.alloc(256 * 1024, 2))
      writeFileSync(join(root, 'c.bin'), Buffer.alloc(1024, 3))
      const outDir = join(tmp.dir, `live-out-${tag}`)
      return {
        root,
        outDir,
        args: {
          root,
          out: join(outDir, 'lib.zip'),
          entries: ['a.bin', 'b.bin', 'c.bin'].map((n) => ({ abs: n, name: n })),
        },
      }
    }

    it('file truncated after the 1st entry → conflict, no .part', async () => {
      const { root, outDir, args } = setup('trunc')
      await expect(
        zipLibrary(args, (p) => {
          if (p.done === 1) truncateSync(join(root, 'b.bin'), 1000)
        }),
      ).rejects.toMatchObject({ code: 'conflict' })
      expect(readdirSync(outDir)).toEqual([])
    })

    it('file deleted after the 1st entry → not_found, no .part', async () => {
      const { root, outDir, args } = setup('rm')
      const run = zipLibrary(args, (p) => {
        if (p.done === 1) rmSync(join(root, 'b.bin'))
      })
      await expect(run).rejects.toMatchObject({ code: 'not_found' })
      await expect(run).rejects.toThrow(/b\.bin/)
      expect(readdirSync(outDir)).toEqual([])
    })

    it('unreadable file (EACCES on open) → io, no .part', async () => {
      const { root, outDir, args } = setup('eacces')
      chmodSync(join(root, 'b.bin'), 0o000)
      try {
        await expect(zipLibrary(args)).rejects.toMatchObject({ code: 'io' })
      } finally {
        chmodSync(join(root, 'b.bin'), 0o644)
      }
      expect(readdirSync(outDir)).toEqual([])
    })
  })
})
