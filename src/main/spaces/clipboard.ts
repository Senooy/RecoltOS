/**
 * Spaces clipboard, Electron 44 async API
 * (`clipboard.write([ClipboardItem])`, `clipboard.read()`). A single `write` with `text/plain` and
 * `text/html`: the HTML carries the internal nodes (`data-recolt-nodes` = base64 of the JSON), the
 * text stays readable by other apps. Reading by priority: internal nodes, Finder files, image,
 * text (a URL is text: a note containing a URL is pasted as a note).
 */
import { ClipboardItem, clipboard } from 'electron'
import { readClipboardFiles, readClipboardImage } from '../import-ux/clipboard'
import { decodeNodesHtml, encodeNodesHtml } from './clipboard-format'

export type SpacesClipboard =
  | { kind: 'nodes'; nodesJson: string }
  | { kind: 'files'; paths: string[] }
  | { kind: 'image'; bytes: Uint8Array<ArrayBuffer> }
  | { kind: 'text'; text: string }
  | null

export async function writeSpacesClipboard(a: { nodesJson: string; text: string }): Promise<void> {
  const html = encodeNodesHtml(a.nodesJson, a.text)
  await clipboard.write([
    new ClipboardItem({
      'text/plain': new Blob([a.text], { type: 'text/plain' }),
      'text/html': new Blob([html], { type: 'text/html' }),
    }),
  ])
}

async function readHtml(): Promise<string | null> {
  let items: ClipboardItem[] = []
  try {
    items = await clipboard.read()
  } catch {
    return null
  }
  for (const it of items) {
    if (!it.types.includes('text/html')) continue
    try {
      const v = await it.getType('text/html')
      if (v instanceof Blob) return await v.text()
    } catch {
      // unreadable format
    }
  }
  return null
}

export async function readSpacesClipboard(): Promise<SpacesClipboard> {
  const html = await readHtml()
  const nodes = html ? decodeNodesHtml(html) : null
  if (nodes) return { kind: 'nodes', nodesJson: nodes }
  const files = await readClipboardFiles()
  if (files.length > 0) return { kind: 'files', paths: files }
  const png = await readClipboardImage()
  if (png) {
    const bytes = new Uint8Array(new ArrayBuffer(png.byteLength))
    bytes.set(png)
    return { kind: 'image', bytes }
  }
  let text = ''
  try {
    text = await clipboard.readText()
  } catch {
    text = ''
  }
  return text.trim() ? { kind: 'text', text: text.slice(0, 20_000) } : null
}
