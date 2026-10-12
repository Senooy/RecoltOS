/** fonctions pures de `scripts/check-dist.mts` (lecture d'asar, autonomie des bundles). */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SIZE_BUDGETS_MB, foreignRequires, readAsar } from '../../../scripts/check-dist.mjs'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Asar minimal : en-tête pickle (taille, longueur, JSON aligné sur 4) puis contenus. */
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
  it('liste les fichiers emballés, met à part les décompressés et lit un contenu', () => {
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
  it('accepte electron et les modules Node, signale le reste', () => {
    expect(
      foreignRequires('require("electron");require("node:path");require("fs/promises")'),
    ).toEqual([])
    expect(foreignRequires('const z = require("zod")\nimport x from "./chunk.js"')).toEqual([
      'zod',
      './chunk.js',
    ])
  })
})

describe('budgets de taille', () => {
  it('sont figés et cohérents', () => {
    expect(SIZE_BUDGETS_MB.appAsar).toBeLessThan(SIZE_BUDGETS_MB.app)
    expect(SIZE_BUDGETS_MB.nativeHost).toBeLessThanOrEqual(120)
  })
})
