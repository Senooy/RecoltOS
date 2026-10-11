/**
 * Lecture du presse-papiers par main (SPACES §3.2, API asynchrone d'Electron 44 :
 * `clipboard.read()` → `ClipboardItem`). Priorité pour ⌘V : fichiers du Finder, puis image, puis
 * URL http(s). Aucun accès depuis le renderer.
 */
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ClipboardItem, clipboard, nativeImage } from 'electron'

const FILE_URL_FORMAT = 'electron application/osclipboard;format="public.file-url"'
const IMAGE_TYPES = ['image/png', 'image/tiff', 'image/jpeg']

async function items(): Promise<ClipboardItem[]> {
  try {
    return await clipboard.read()
  } catch {
    return []
  }
}

async function blobOf(item: ClipboardItem, type: string): Promise<Buffer | null> {
  try {
    const v = await item.getType(type)
    if (v instanceof Blob) return Buffer.from(await v.arrayBuffer())
    return null
  } catch {
    return null
  }
}

/** Image du presse-papiers convertie en PNG, ou `null`. */
export async function readClipboardImage(): Promise<Buffer | null> {
  for (const it of await items()) {
    for (const t of IMAGE_TYPES) {
      if (!it.types.includes(t)) continue
      const buf = await blobOf(it, t)
      if (!buf || buf.length === 0) continue
      if (t === 'image/png') return buf
      const img = nativeImage.createFromBuffer(buf)
      if (!img.isEmpty()) return img.toPNG()
    }
  }
  return null
}

export async function clipboardImageHash(): Promise<string | null> {
  const png = await readClipboardImage()
  return png ? createHash('sha1').update(png).digest('hex') : null
}

/** Chemins de fichiers copiés depuis le Finder. */
export async function readClipboardFiles(): Promise<string[]> {
  const out: string[] = []
  for (const it of await items()) {
    for (const t of ['text/uri-list', FILE_URL_FORMAT]) {
      if (!it.types.includes(t)) continue
      const buf = await blobOf(it, t)
      if (!buf) continue
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        const s = line.trim()
        if (!s.startsWith('file://')) continue
        try {
          out.push(fileURLToPath(s))
        } catch {
          // URL de fichier invalide
        }
      }
    }
  }
  return [...new Set(out)]
}

/** URL http(s) du presse-papiers (texte), ou `null`. */
export async function readClipboardUrl(): Promise<string | null> {
  let text = ''
  try {
    text = (await clipboard.readText()).trim()
  } catch {
    return null
  }
  if (!/^https?:\/\/\S+$/i.test(text)) return null
  try {
    const u = new URL(text)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

export async function writeClipboardPng(png: Buffer): Promise<void> {
  await clipboard.write([
    new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) }),
  ])
}
