/**
 * Index des médias distants déjà téléchargés (`remote/<sha1(url)>.<ext>`) : les DTO n'en
 * exposent l'URL `recolt://` que si le fichier existe, et ne laissent jamais sortir l'URL http(s).
 * Lecture paresseuse du dossier (un `readdir` par bibliothèque), complétée par `remote.fetch`.
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
    // dossier absent : rien de téléchargé
  }
  byRoot.set(root, map)
  return map
}

export function remoteKey(url: string): string {
  return sha1(url)
}

/** Chemin relatif du fichier téléchargé pour `url`, ou `null`. */
export function remoteRelFor(root: string, url: string): string | null {
  return load(root).get(sha1(url)) ?? null
}

export function recordRemote(root: string, url: string, relPath: string): void {
  load(root).set(sha1(url), relPath)
}

/** Tests, bascule de bibliothèque. */
export function resetRemoteIndex(root?: string): void {
  if (root) byRoot.delete(root)
  else byRoot.clear()
}
