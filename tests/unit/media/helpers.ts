import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MediaTools } from '../../../src/main/workers/media/exec'
import { FFMPEG, FFPROBE, SIPS } from '../../fixtures/media/generate'

export const TOOLS: MediaTools = { ffmpeg: FFMPEG, ffprobe: FFPROBE, sips: SIPS }

export function makeTmp(prefix = 'recolt-media-'): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

export function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
