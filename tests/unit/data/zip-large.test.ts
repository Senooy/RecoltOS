/**
 * export > 4 GB (ZIP64) validated by `unzip -t`. Slow and disk-hungry (≈ 4.3 GB written):
 * opt-in with `RECOLT_TEST_ZIP_LARGE=1` (e.g. `RECOLT_TEST_ZIP_LARGE=1 pnpm exec vitest run
 * tests/unit/data/zip-large.test.ts`). The originals are sparse files (APFS).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { zipLibrary } from '../../../src/main/workers/media/files'

const enabled = process.env.RECOLT_TEST_ZIP_LARGE === '1'

describe.skipIf(!enabled)('export zip > 4 GB', () => {
  it('ZIP64 valid, progress complete', { timeout: 900_000 }, async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'recolt-zip64-'))
    try {
      const root = path.join(base, 'lib')
      fs.mkdirSync(path.join(root, 'items/ab'), { recursive: true })
      const entries = []
      for (let i = 0; i < 3; i++) {
        const rel = `items/ab/video-${i}.mp4`
        const fd = fs.openSync(path.join(root, rel), 'w')
        fs.ftruncateSync(fd, 1_450_000_000) // 3 × 1.45 GB ≈ 4.35 GB
        fs.closeSync(fd)
        entries.push({ abs: rel, name: rel })
      }
      const out = path.join(base, 'export.zip')
      let last = { done: 0, total: 0 }
      const r = await zipLibrary({ root, entries, out }, (p) => (last = p))
      expect(r.bytes).toBeGreaterThan(4 * 1024 ** 3)
      expect(last).toEqual({ done: 3, total: 3 })
      execFileSync('unzip', ['-tq', out], { stdio: 'pipe' })
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  })
})
