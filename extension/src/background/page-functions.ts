/**
 * Functions injected into the page by `scripting.executeScript` (serialized: NO capture of
 * outer variable, no imports). Reads metadata and reads a blob in chunks,
 * toast in shadow DOM.
 */

export interface PageMeta {
  title: string
  ogImage?: string
  ogTitle?: string
  description?: string
  siteName?: string
  favicon?: string
  dark: boolean
}

export function readPageMeta(): PageMeta {
  const meta = (sel: string) =>
    document.querySelector<HTMLMetaElement>(sel)?.content?.trim() || undefined
  const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href
  const out: PageMeta = {
    title: document.title,
    dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
  }
  const og = meta('meta[property="og:image"]')
  if (og) out.ogImage = new URL(og, location.href).href
  const ogt = meta('meta[property="og:title"]')
  if (ogt) out.ogTitle = ogt
  const d = meta('meta[name="description"]') ?? meta('meta[property="og:description"]')
  if (d) out.description = d.slice(0, 4000)
  const s = meta('meta[property="og:site_name"]')
  if (s) out.siteName = s
  if (icon) out.favicon = icon
  return out
}

/** Size and type of a `blob:` / `data:` resource read IN the page (keeps the blob cached). */
export async function probeBlob(
  url: string,
): Promise<{ size: number; mime: string } | { error: string }> {
  try {
    const w = window as unknown as { __recoltosBlobs?: Map<string, Blob> }
    w.__recoltosBlobs ??= new Map()
    const blob = await (await fetch(url)).blob()
    w.__recoltosBlobs.set(url, blob)
    return { size: blob.size, mime: blob.type || 'application/octet-stream' }
  } catch (e) {
    return { error: String(e) }
  }
}

/** Chunk `[offset, offset + length)` of the base64 blob; `release` frees the cache. */
export async function readBlobChunk(
  url: string,
  offset: number,
  length: number,
  release: boolean,
): Promise<string | null> {
  const w = window as unknown as { __recoltosBlobs?: Map<string, Blob> }
  const blob = w.__recoltosBlobs?.get(url)
  if (!blob) return null
  const part = blob.slice(offset, offset + length)
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve((r.result as string).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error ?? new Error('lecture'))
    r.readAsDataURL(part)
  })
  if (release) w.__recoltosBlobs?.delete(url)
  return data
}

/** Confirmation pill: 3 s, optional black button. */
export function showToast(
  text: string,
  kind: 'ok' | 'info' | 'error',
  action: string | null,
): void {
  const ID = '__recoltos_toast'
  document.getElementById(ID)?.remove()
  const host = document.createElement('div')
  host.id = ID
  host.style.cssText =
    'all:initial;position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647'
  const root = host.attachShadow({ mode: 'closed' })
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const bg = dark ? '#1c1c1e' : '#ffffff'
  const fg = dark ? '#f5f5f7' : '#1d1d1f'
  const dot = kind === 'error' ? '#ff453a' : kind === 'info' ? '#8e8e93' : '#30d158'
  const style = document.createElement('style')
  style.textContent = `
    .t{display:flex;align-items:center;gap:10px;padding:8px 8px 8px 14px;border-radius:999px;
      background:${bg};color:${fg};font:500 13px/18px -apple-system,BlinkMacSystemFont,'Geist',sans-serif;
      box-shadow:0 8px 28px rgba(0,0,0,.18),0 0 0 .5px rgba(0,0,0,.12);
      opacity:0;transform:translateY(8px);transition:opacity .18s ease,transform .18s ease}
    .t.on{opacity:1;transform:none}
    .d{width:7px;height:7px;border-radius:50%;background:${dot};flex:none}
    .s{padding-right:6px;white-space:nowrap;max-width:420px;overflow:hidden;text-overflow:ellipsis}
    button{all:unset;cursor:pointer;background:#111;color:#fff;border-radius:999px;padding:5px 12px;font-size:12.5px}`
  const box = document.createElement('div')
  box.className = 't'
  box.setAttribute('role', 'status')
  box.setAttribute('aria-live', 'polite')
  const d = document.createElement('span')
  d.className = 'd'
  const label = document.createElement('span')
  label.className = 's'
  label.textContent = text
  box.append(d, label)
  root.append(style, box)
  if (action) {
    const b = document.createElement('button')
    b.textContent = action
    b.addEventListener('click', () => host.remove())
    box.appendChild(b)
  }
  document.documentElement.appendChild(host)
  requestAnimationFrame(() => box.classList.add('on'))
  setTimeout(() => {
    box.classList.remove('on')
    setTimeout(() => host.remove(), 250)
  }, 3_000)
}
