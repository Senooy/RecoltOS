/** Test library for AI: real database, media-worker in process, synthetic files. */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import type { PostMetaInput } from '../../../src/shared/post-meta'
import { PostMetaSchema } from '../../../src/shared/post-meta'
import type { MediaArgs, MediaOp, MediaResult } from '../../../src/shared/worker-protocol'
import type { MediaCaller } from '../../../src/main/jobs/handlers/types'
import type { LibraryContext } from '../../../src/main/library/library-context'
import { libraryPaths } from '../../../src/main/library/paths'
import { runMediaOp } from '../../../src/main/workers/media/ops'
import { openTestLib, type TestLib } from '../db/helpers'
import { TOOLS } from '../media/helpers'

export interface AiLib {
  t: TestLib
  lib: LibraryContext
  media: MediaCaller
  userData: string
  framesDir: string
  cleanup(): void
}

export function makeAiLib(): AiLib {
  const t = openTestLib()
  const lib: LibraryContext = {
    id: 'ltest',
    name: 'Test',
    root: t.root,
    paths: libraryPaths(t.root),
    db: t.db,
    repos: t.repos,
  }
  const userData = mkdtempSync(join(tmpdir(), 'recolt-ai-ud-'))
  const media: MediaCaller = <O extends MediaOp>(op: O, args: MediaArgs<O>) =>
    runMediaOp(op, args, { tools: TOOLS }) as Promise<MediaResult<O>>
  return {
    t,
    lib,
    media,
    userData,
    framesDir: join(userData, 'cache', 'frames'),
    cleanup() {
      t.cleanup()
      rmSync(userData, { recursive: true, force: true })
    },
  }
}

/** Writes a plain image (with EXIF orientation) under `items/` and returns its relative path. */
export async function writeImage(
  lib: LibraryContext,
  rel: string,
  color = '#336699',
  size: [number, number] = [2400, 1600],
): Promise<string> {
  const abs = lib.paths.abs(rel)
  mkdirSync(dirname(abs), { recursive: true })
  await sharp({ create: { width: size[0], height: size[1], channels: 3, background: color } })
    .jpeg({ quality: 80 })
    .withMetadata({ orientation: 1, exif: { IFD0: { Copyright: 'secret', Artist: 'gps' } } })
    .toFile(abs)
  return rel
}

export function post(p: Partial<PostMetaInput> & { text: string }) {
  return PostMetaSchema.parse({
    v: 1,
    platform: 'instagram',
    author: { name: 'Ada', handle: 'ada', avatarUrl: null },
    url: null,
    postedAt: null,
    ...p,
  })
}
