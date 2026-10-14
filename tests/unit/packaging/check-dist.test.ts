/** Pure functions of `scripts/check-dist.mts` (asar reading, bundle self-containment). */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SIZE_BUDGETS_MB, foreignRequires, readAsar } from '../../../scripts/check-dist.mjs'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Minimal asar: pickle header (size, length, JSON aligned on 4) then contents. */
function makeAsar(files: Record<string, string>, unpacked: string[] = []): string {
  const tree: { files: Record<string, unknown> } = { files: {} }
  const chunks: Buffer[] = []
  let offset = 0
  for (const [p, content] of Object.entries(files)) {
    const parts = p.split('/')
    let dir = tree
    for (const part of parts.slice(0, -1)) {
      dir.files[part] ??= { files: {} }
      dir = dir.files[part] as typeof tree
    }
    const data = Buffer.from(content)
    dir.files[parts.at(-1)!] = unpacked.includes(p)
      ? { size: data.length, unpacked: true }
      : { size: data.length, offset: String(offset) }
    if (!unpacked.includes(p)) {
      chunks.push(data)
      offset += data.length
    }
  }
  const json = Buffer.from(JSON.stringify(tree))
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4)
  json.copy(padded)
  const header = Buffer.alloc(16)
  header.writeUInt32LE(4, 0)
  header.writeUInt32LE(8 + padded.length, 4)
  header.writeUInt32LE(4 + padded.length, 8)
  header.writeUInt32LE(json.length, 12)
  const dir = mkdtempSync(join(tmpdir(), 'recolt-asar-'))
  dirs.push(dir)
  const file = join(dir, 'app.asar')
  writeFileSync(file, Buffer.concat([header, padded, ...chunks]))
  return file
}

describe('readAsar', () => {
  it('lists packed files, sets unpacked ones apart and reads a content', () => {
    const f = makeAsar(
      {
        'out/preload/index.js': 'require("electron")',
        'node_modules/x/a.node': 'MACHO',
        'package.json': '{}',
      },
      ['node_modules/x/a.node'],
    )
    const a = readAsar(f)
    expect(a.files.sort()).toEqual(['out/preload/index.js', 'package.json'])
    expect(a.unpacked).toEqual(['node_modules/x/a.node'])
    expect(a.read('out/preload/index.js')?.toString()).toBe('require("electron")')
    expect(a.read('node_modules/x/a.node')).toBeNull()
  })
})

describe('foreignRequires', () => {
  it('accepts electron and Node modules, reports the rest', () => {
    expect(
      foreignRequires('require("electron");require("node:path");require("fs/promises")'),
    ).toEqual([])
    expect(foreignRequires('const z = require("zod")\nimport x from "./chunk.js"')).toEqual([
      'zod',
      './chunk.js',
    ])
  })
})

describe('size budgets', () => {
  it('are frozen and consistent', () => {
    expect(SIZE_BUDGETS_MB.appAsar).toBeLessThan(SIZE_BUDGETS_MB.app)
    expect(SIZE_BUDGETS_MB.nativeHost).toBeLessThanOrEqual(5)
  })
})
