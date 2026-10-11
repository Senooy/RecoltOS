/**
 * Boutons « Enregistrer dans RecoltOS » injectés à côté du bouton d'enregistrement natif (SYNC §2.4)
 * sur x.com et instagram.com. Traitement par lots (MutationObserver), repli DOM si la donnée brute
 * n'est pas en cache (`partial`). Jamais de clic simulé ni d'action sur le compte.
 */
import type { BridgePlatform } from '../../../src/shared/bridge/constants'
import { showToast } from '../background/page-functions'

export interface PostRef {
  platform: BridgePlatform
  externalId: string
  url: string
  dom: { text?: string; authorName?: string; authorHandle?: string; imageUrls?: string[] }
}

export const BUTTON_LABEL = 'Enregistrer dans RecoltOS'
const MARK = 'data-recoltos'

function button(doc: Document, onClick: () => void): HTMLButtonElement {
  const b = doc.createElement('button')
  b.type = 'button'
  b.setAttribute('aria-label', BUTTON_LABEL)
  b.title = BUTTON_LABEL
  b.setAttribute(MARK, '1')
  b.style.cssText =
    'all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:999px;color:inherit;opacity:.75'
  // Glyphe simple (carré arrondi + flèche vers le bas), sans ressource externe.
  const ns = 'http://www.w3.org/2000/svg'
  const svg = doc.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '18')
  svg.setAttribute('height', '18')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.8')
  const path = doc.createElementNS(ns, 'path')
  path.setAttribute('d', 'M5 4h14v16H5z M12 8v7 M8.5 12l3.5 3.5 3.5-3.5')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.appendChild(path)
  b.appendChild(svg)
  b.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onClick()
  })
  return b
}

/** Publication X d'un `article` (identifiant par le lien horodaté). */
export function xPostOf(article: Element, origin: string): PostRef | null {
  const link = [...article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')].find((a) =>
    a.querySelector('time'),
  )
  const m = link ? /\/([^/]+)\/status\/(\d+)/.exec(link.getAttribute('href') ?? '') : null
  if (!m?.[2]) return null
  const name = article.querySelector('[data-testid="User-Name"]')?.textContent ?? undefined
  const text = article.querySelector('[data-testid="tweetText"]')?.textContent ?? undefined
  const imageUrls = [
    ...article.querySelectorAll<HTMLImageElement>('[data-testid="tweetPhoto"] img'),
  ]
    .map((i) => i.src)
    .filter((s) => /^https:/.test(s))
  return {
    platform: 'x',
    externalId: m[2],
    url: `${origin}/${m[1]}/status/${m[2]}`,
    dom: {
      ...(text ? { text } : {}),
      ...(name ? { authorName: name.split('@')[0]?.trim() } : {}),
      authorHandle: m[1],
      ...(imageUrls.length ? { imageUrls } : {}),
    },
  }
}

/** Publication Instagram d'un `article` (code court par le lien `/p/` ou `/reel/`). */
export function igPostOf(article: Element, origin: string): PostRef | null {
  const a = article.querySelector<HTMLAnchorElement>('a[href^="/p/"], a[href^="/reel/"]')
  const m = a ? /^\/(?:p|reel)\/([\w-]+)/.exec(a.getAttribute('href') ?? '') : null
  if (!m?.[1]) return null
  const imageUrls = [...article.querySelectorAll<HTMLImageElement>('img[src^="https://"]')]
    .map((i) => i.src)
    .slice(0, 20)
  return {
    platform: 'instagram',
    externalId: m[1],
    url: `${origin}/p/${m[1]}/`,
    dom: imageUrls.length ? { imageUrls } : {},
  }
}

const IG_SAVE_LABELS = ['Save', 'Enregistrer', 'Remove', 'Supprimer', 'Retirer']

/** Ajoute les boutons dans `root` ; rend le nombre ajouté (idempotent). */
export function injectInto(
  root: ParentNode,
  hostname: string,
  origin: string,
  save: (ref: PostRef) => Promise<{ status?: string } | undefined>,
): number {
  let n = 0
  const doc = (root as Node).ownerDocument ?? (root as Document)
  const onSave = (ref: PostRef) => () =>
    void save(ref)
      .then((r) =>
        showToast(
          r?.status === 'saved'
            ? 'Enregistré dans RecoltOS'
            : r?.status === 'duplicate'
              ? 'Déjà dans ta bibliothèque'
              : r?.status === 'queued'
                ? 'RecoltOS est fermé : ajouté au prochain lancement'
                : 'Enregistrement impossible',
          r?.status === 'saved' ? 'ok' : r?.status === 'error' || !r ? 'error' : 'info',
          null,
        ),
      )
      .catch(() => showToast('Enregistrement impossible', 'error', null))
  if (/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(hostname)) {
    for (const art of root.querySelectorAll('article[data-testid="tweet"]')) {
      const group = art.querySelector('div[role="group"]')
      if (!group || group.querySelector(`[${MARK}]`)) continue
      const ref = xPostOf(art, origin)
      if (!ref) continue
      group.appendChild(button(doc, onSave(ref)))
      n += 1
    }
  } else if (/(^|\.)instagram\.com$/.test(hostname)) {
    for (const art of root.querySelectorAll('article')) {
      if (art.querySelector(`[${MARK}]`)) continue
      const icon = [...art.querySelectorAll('svg[aria-label]')].find((s) =>
        IG_SAVE_LABELS.includes(s.getAttribute('aria-label') ?? ''),
      )
      const bar = icon?.closest('section') ?? icon?.parentElement?.parentElement
      const ref = igPostOf(art, origin)
      if (!bar || !ref) continue
      bar.appendChild(button(doc, onSave(ref)))
      n += 1
    }
  }
  return n
}

export function injectButtons(
  doc: Document,
  save: (ref: PostRef) => Promise<{ status?: string } | undefined>,
): void {
  const run = () => injectInto(doc, location.hostname, location.origin, save)
  run()
  let scheduled = false
  new MutationObserver(() => {
    if (scheduled) return
    scheduled = true
    const idle = (globalThis as { requestIdleCallback?: (f: () => void) => void })
      .requestIdleCallback
    ;(idle ?? ((f: () => void) => setTimeout(f, 200)))(() => {
      scheduled = false
      run()
    })
  }).observe(doc.documentElement, { childList: true, subtree: true })
}
