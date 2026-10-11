import { describe, expect, it, vi } from 'vitest'
import { createOpenFileBatcher } from '../../../src/main/import-ux/open-file'
import { expand } from '../../../src/main/ingest/files'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('« Ouvrir avec » : regroupement 250 ms', () => {
  it('N événements → un seul import ; un élément → vue détail', async () => {
    const importPaths = vi.fn((paths: string[]) =>
      Promise.resolve({
        added: paths.slice(0, 1).map(() => ({ itemUuid: '00000000-0000-4000-8000-000000000001' })),
        duplicates: [],
        failed: [],
      }),
    )
    const openItem = vi.fn()
    const w = { show: vi.fn(), focus: vi.fn() }
    const b = createOpenFileBatcher(
      { ensureWindow: () => Promise.resolve(w), importPaths, openItem },
      20,
    )
    b.push(['/a.png'])
    b.push(['/b.png'])
    await new Promise((r) => setTimeout(r, 60))
    await b.idle()
    expect(importPaths).toHaveBeenCalledTimes(1)
    expect(importPaths).toHaveBeenCalledWith(['/a.png', '/b.png'])
    expect(w.show).toHaveBeenCalled()
    expect(openItem).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001')
  })
})

describe('parcours des dossiers déposés', () => {
  it('récursif ≤ 12 niveaux, cachés et non-médias ignorés, liens non suivis', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recolt-walk-'))
    let d = root
    for (let i = 0; i < 14; i++) {
      fs.writeFileSync(path.join(d, `n${i}.jpg`), 'x')
      d = path.join(d, `s${i}`)
      fs.mkdirSync(d)
    }
    fs.writeFileSync(path.join(root, '.cache.png'), 'x')
    fs.writeFileSync(path.join(root, 'notes.txt'), 'x')
    fs.symlinkSync(root, path.join(root, 'boucle'))
    const out = await expand([root])
    expect(out.every((p) => p.endsWith('.jpg'))).toBe(true)
    expect(out).toHaveLength(12)
    // Un fichier déposé seul est toujours essayé (erreur « non pris en charge » visible).
    expect(await expand([path.join(root, 'notes.txt')])).toEqual([path.join(root, 'notes.txt')])
    fs.rmSync(root, { recursive: true, force: true })
  })
})
