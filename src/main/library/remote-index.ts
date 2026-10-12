/**
 * Index of remote media already downloaded (`remote/<sha1(url)>.<ext>`): the DTOs only expose
 * the `recolt://` URL if the file exists, and never let the http(s) URL out.
 * Lazy reading of the folder (one `readdir` per library), completed by `remote.fetch`.
 */
import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex')

const byRoot = new Map<string, Map<string, string>>()

function load(root: string): Map<string, string> {
  let map = byRoot.get(root)
  if (map) return map
  map = new Map()
  try {
    for (const name of readdirSync(join(root, 'remote'))) {
      const m = /^([0-9a-f]{40})\.([a-z0-9]{1,8})$/.exec(name)
      if (m?.[1]) map.set(m[1], `remote/${name}`)
    }
  } catch {
    // folder missing: nothing downloaded
  }
  byRoot.set(root, map)
  return map
}

export function remoteKey(url: string): string {
  return sha1(url)
}

/** Relative path of the downloaded file for `url`, or `null`. */
export function remoteRelFor(root: string, url: string): string | null {
  return load(root).get(sha1(url)) ?? null
}

export function recordRemote(root: string, url: string, relPath: string): void {
  load(root).set(sha1(url), relPath)
}

/** Tests, library switch. */
export function resetRemoteIndex(root?: string): void {
  if (root) byRoot.delete(root)
  else byRoot.clear()
}
