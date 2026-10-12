/**
 * Enregistrement depuis l'extension : menu contextuel, raccourci, popup → `save.create`.
 * Images `blob:` / `data:` lues dans la page : ≤ 8 Mio inline, jusqu'à 200 Mo en `media.chunk` de
 * 8 Mio (app ouverte), au-delà refus. Toast dans la page, badge ✓ et notification en secours.
 */
import {
  CHUNK_BYTES,
  MAX_INLINE_MEDIA_BYTES,
  MAX_UPLOAD_BYTES,
} from '../../../src/shared/bridge/constants'
import type { SaveAck, SaveRequest } from '../../../src/shared/bridge/save'
import type { NativeBridge } from './native'
import { BridgeError } from './native'
import { xt, type ExtMessages } from '../lib/i18n'
import { probeBlob, readBlobChunk, type PageMeta } from './page-functions'

/** Textes des toasts dans la langue active (chaque lecture passe par `xt()`). */
export const TOAST: ExtMessages['toast'] = new Proxy({} as ExtMessages['toast'], {
  get: (_t, key: string) => xt().toast[key as keyof ExtMessages['toast']],
})

export interface SaveDeps {
  bridge: Pick<NativeBridge, 'request' | 'post' | 'state'>
  /** `scripting.executeScript` dans l'onglet (fonction sérialisée). */
  exec<A extends unknown[], R>(tabId: number, fn: (...a: A) => R, args: A): Promise<Awaited<R>>
  captureTab(windowId: number | undefined): Promise<string | null>
  pageMeta(tabId: number): Promise<PageMeta | null>
  toast(
    tabId: number | undefined,
    text: string,
    kind: 'ok' | 'info' | 'error',
    action?: string,
  ): void
  newId(): string
}

export interface MenuInfo {
  menuItemId: string | number
  mediaType?: string
  srcUrl?: string
  linkUrl?: string
  pageUrl?: string
}

export interface TabLike {
  id?: number
  windowId?: number
  url?: string
  title?: string
}

export type SaveOutcome = SaveAck | { status: 'refused'; error: string }

const isHttp = (u: string | undefined) => !!u && /^https?:\/\//i.test(u)

/** Contexte du clic → requête (sans le binaire). `null` : type non pris en charge. */
export function baseRequest(info: MenuInfo, tab: TabLike): SaveRequest | null {
  const pageUrl = info.pageUrl ?? tab.url ?? ''
  if (!isHttp(pageUrl)) return null
  const pageTitle = tab.title ? tab.title.slice(0, 1000) : undefined
  const common = { pageUrl, ...(pageTitle ? { pageTitle } : {}) }
  if (info.mediaType === 'image' && info.srcUrl)
    return { kind: 'image', ...common, srcUrl: info.srcUrl }
  if (info.mediaType === 'video' && info.srcUrl)
    return { kind: 'video', ...common, srcUrl: info.srcUrl }
  if (info.linkUrl) return { kind: 'link', ...common, linkUrl: info.linkUrl }
  return { kind: 'page', ...common }
}

function ackText(ack: SaveOutcome): {
  text: string
  kind: 'ok' | 'info' | 'error'
  action?: string
} {
  if (ack.status === 'saved') {
    return ack.collectionName
      ? { text: TOAST.addedTo(ack.collectionName), kind: 'ok' }
      : { text: TOAST.saved, kind: 'ok', action: TOAST.addToCollection }
  }
  if (ack.status === 'duplicate') return { text: TOAST.duplicate, kind: 'info' }
  if (ack.status === 'queued') return { text: TOAST.queued, kind: 'info' }
  return { text: TOAST.failed(ack.error ?? TOAST.error), kind: 'error' }
}

async function send(deps: SaveDeps, req: SaveRequest): Promise<SaveOutcome> {
  try {
    const m = await deps.bridge.request('save.create', req, 120_000)
    return m.payload as SaveAck
  } catch (err) {
    const code = err instanceof BridgeError ? err.code : 'ERROR'
    if (code === 'NOT_CONNECTED' || deps.bridge.state === 'host_missing') {
      return { status: 'refused', error: TOAST.hostMissing }
    }
    if (code === 'APP_NOT_RUNNING') return { status: 'refused', error: TOAST.appClosed }
    return { status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

/** Lit un `blob:` / `data:` dans la page puis l'envoie inline ou par morceaux. */
async function withBinary(
  deps: SaveDeps,
  tabId: number,
  req: SaveRequest,
  src: string,
): Promise<SaveRequest | { refused: string }> {
  const probe = await deps.exec(tabId, probeBlob, [src])
  if (!probe || 'error' in probe) return { refused: TOAST.failed(TOAST.readFile) }
  const { size, mime } = probe
  if (size > MAX_UPLOAD_BYTES) return { refused: TOAST.tooBig }
  const { srcUrl: _drop, ...rest } = req
  if (size <= MAX_INLINE_MEDIA_BYTES) {
    const data = await deps.exec(tabId, readBlobChunk, [src, 0, size, true])
    if (data === null) return { refused: TOAST.failed(TOAST.readFile) }
    return { ...rest, inlineMedia: { mime, dataBase64: data } }
  }
  if (deps.bridge.state !== 'app_connected') return { refused: TOAST.bigNeedsApp }
  const id = deps.newId()
  let seq = 0
  for (let off = 0; off < size; off += CHUNK_BYTES) {
    const last = off + CHUNK_BYTES >= size
    const data = await deps.exec(tabId, readBlobChunk, [src, off, CHUNK_BYTES, last])
    if (data === null) return { refused: TOAST.failed(TOAST.readFile) }
    deps.bridge.post('media.chunk', { jobId: id, seq, last, mime, data })
    seq += 1
  }
  return { ...rest, upload: { id, mime, size } }
}

/** Enregistre ce qui a été cliqué ; affiche le toast ; rend l'accusé. */
export async function saveFromClick(
  deps: SaveDeps,
  info: MenuInfo,
  tab: TabLike,
  extra: { collectionId?: string | null; note?: string } = {},
): Promise<SaveOutcome> {
  const tabId = tab.id
  let req = baseRequest(info, tab)
  if (!req) {
    const out = { status: 'refused' as const, error: TOAST.failed(TOAST.unsupportedPage) }
    deps.toast(tabId, out.error, 'error')
    return out
  }
  if (extra.collectionId) req.collectionId = extra.collectionId
  if (extra.note) req.note = extra.note.slice(0, 5000)

  if ((req.kind === 'image' || req.kind === 'video') && req.srcUrl && !isHttp(req.srcUrl)) {
    if (req.kind === 'video' && req.srcUrl.startsWith('blob:')) {
      deps.toast(tabId, TOAST.videoStream, 'error')
      return { status: 'refused', error: TOAST.videoStream }
    }
    if (tabId === undefined) return { status: 'refused', error: TOAST.failed(TOAST.unknownTab) }
    const r = await withBinary(deps, tabId, req, req.srcUrl)
    if ('refused' in r) {
      deps.toast(tabId, r.refused, 'error')
      return { status: 'refused', error: r.refused }
    }
    req = r
  } else if (req.kind === 'page' && tabId !== undefined) {
    const [shot, meta] = await Promise.all([deps.captureTab(tab.windowId), deps.pageMeta(tabId)])
    if (meta) {
      const pm: NonNullable<SaveRequest['pageMeta']> = {}
      if (meta.ogImage) pm.ogImage = meta.ogImage
      if (meta.ogTitle) pm.ogTitle = meta.ogTitle
      if (meta.description) pm.description = meta.description
      if (meta.siteName) pm.siteName = meta.siteName
      if (meta.favicon) pm.favicon = meta.favicon
      req.pageMeta = pm
      if (!req.pageTitle && meta.title) req.pageTitle = meta.title.slice(0, 1000)
    }
    const m = shot ? /^data:(image\/(?:jpeg|png));base64,(.*)$/.exec(shot) : null
    if (m?.[1] && m[2]) {
      req.screenshot = {
        mime: m[1] as 'image/jpeg' | 'image/png',
        dataBase64: m[2],
        width: 0,
        height: 0,
      }
    }
  }
  const ack = await send(deps, req)
  const t =
    'status' in ack && ack.status === 'refused'
      ? { text: ack.error, kind: 'error' as const }
      : ackText(ack)
  deps.toast(tabId, t.text, t.kind, 'action' in t ? t.action : undefined)
  return ack
}
