/**
 * Garbage collector for Spaces assets: removes the files in `spaces/assets/<ab>/` whose hash
 * appears in no `space_nodes.asset_rel` (derivatives `.thumb.*` / `.orig.*` included), and the
 * temporary files in `tmp/spaces/`.
 * Run ONLY when the library is opened: cancelling an ongoing session can still restore a node
 * whose asset is no longer referenced in the database.
 */
import { readdir, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'
import type { LibraryContext } from '../library/library-context'

const SHA_FILE = /^([0-9a-f]{64})\./

export async function gcSpaceAssets(
  lib: Pick<LibraryContext, 'db' | 'paths'>,
): Promise<{ removed: number; kept: number }> {
  const referenced = new Set<string>()
  for (const r of lib.db
    .prepare('SELECT DISTINCT asset_rel FROM space_nodes WHERE asset_rel IS NOT NULL')
    .all() as { asset_rel: string }[]) {
    const m = SHA_FILE.exec(path.posix.basename(r.asset_rel))
    if (m) referenced.add(m[1]!)
  }
  const root = path.join(lib.paths.dir('spaces'), 'assets')
  let removed = 0
  let kept = 0
  let shards: string[] = []
  try {
    shards = await readdir(root)
  } catch {
    shards = []
  }
  for (const shard of shards) {
    if (!/^[0-9a-f]{2}$/.test(shard)) continue
    const dir = path.join(root, shard)
    let files: string[] = []
    try {
      files = await readdir(dir)
    } catch {
      continue
    }
    let left = files.length
    for (const f of files) {
      const m = SHA_FILE.exec(f)
      if (!m || referenced.has(m[1]!)) {
        kept++
        continue
      }
      await rm(path.join(dir, f), { force: true })
      removed++
      left--
    }
    if (left === 0) await rmdir(dir).catch(() => undefined)
  }
  await rm(path.join(lib.paths.dir('tmp'), 'spaces'), { recursive: true, force: true })
  return { removed, kept }
}
