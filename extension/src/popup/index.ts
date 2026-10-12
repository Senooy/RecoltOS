/**
 * Popup 360×520 (informal "tu" tone): bridge state, preview, saving the page or
 * the main image, collection, note, per-platform sync state and "Sync now". Firefox: an "Allow
 * site access" button if host permissions (optional in MV3) are missing.
 * (optionnelles en MV3) manquent.
 */
import { BRIDGE_PLATFORMS, type BridgePlatform } from '../../../src/shared/bridge/constants'
import type { BridgeCollection } from '../../../src/shared/bridge/save'
import { api } from '../lib/api'
import { ENDPOINTS } from '../lib/endpoints'
import { setExtLang, xt } from '../lib/i18n'
import type { PopupRequest, PopupState } from '../lib/popup-protocol'

/** Label and help of each bridge state, in the active language. */
export const STATUS_TEXT: Record<string, { label: string; hint?: string }> = new Proxy(
  {},
  {
    get: (_t, key: string) => xt().status[key],
    ownKeys: () => Reflect.ownKeys(xt().status),
    getOwnPropertyDescriptor: (_t, key: string) => ({
      enumerable: true,
      configurable: true,
      value: xt().status[key],
    }),
  },
)

const NAMES: Record<BridgePlatform, string> = { x: 'X', instagram: 'Instagram', cosmos: 'Cosmos' }

/** Relative time labels, e.g. "4 min ago", "2 h ago", "yesterday" (French: "il y a 4 min", "hier"). */
export function relTime(at: number, now = Date.now()): string {
  const t = xt().time
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return t.now
  const m = Math.round(s / 60)
  if (m < 60) return t.minutes(m)
  const h = Math.round(m / 60)
  if (h < 24) return t.hours(h)
  const d = Math.round(h / 24)
  return d === 1 ? t.yesterday : t.days(d)
}

export function syncLine(p: BridgePlatform, st: PopupState, now = Date.now()): string {
  const plat = st.platforms?.[p]
  const sync = st.sync?.[p]
  const l = xt().syncLine
  if (plat && plat.permission === false) return l.permission(NAMES[p])
  if (sync && !sync.enabled) return l.disabled(NAMES[p])
  if (plat && !plat.loggedIn) return l.notLoggedIn(NAMES[p])
  if (sync?.lastSuccessAt != null) return l.last(NAMES[p], relTime(sync.lastSuccessAt, now))
  return l.connected(NAMES[p])
}

function send<T>(msg: PopupRequest): Promise<T> {
  return api().runtime.sendMessage(msg)
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

/** Static texts of `popup.html` (`data-i18n*` attributes), in the active language. */
export function applyStaticTexts(doc: Document): void {
  const p = xt().popup as Record<string, string>
  for (const el of doc.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const v = p[el.dataset.i18n ?? '']
    if (v) el.textContent = v
  }
  for (const el of doc.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) {
    const v = p[el.dataset.i18nPlaceholder ?? '']
    if (v) el.setAttribute('placeholder', v)
  }
  for (const el of doc.querySelectorAll<HTMLElement>('[data-i18n-label]')) {
    const v = p[el.dataset.i18nLabel ?? '']
    if (v) el.setAttribute('aria-label', v)
  }
}

async function main(): Promise<void> {
  const st = await send<PopupState>({ type: 'popup:state' })
  setExtLang(st.lang)
  document.documentElement.lang = st.lang
  applyStaticTexts(document)
  let selected: string | null = st.lastCollectionId
  let collections: BridgeCollection[] = st.collections

  // ---- state
  const key = st.stale ? 'stale' : st.bridge
  const status = STATUS_TEXT[key] ?? STATUS_TEXT.connecting!
  const pill = $('status')
  pill.dataset.state = key
  pill.querySelector('span')!.textContent = status.label
  const hint = $('statusHint')
  hint.hidden = !status.hint
  hint.textContent = status.hint ?? ''

  // ---- preview
  $<HTMLInputElement>('title').value = st.tab.title ?? ''
  try {
    const shot = await api().tabs.captureVisibleTab({ format: 'jpeg', quality: 70 })
    const img = $<HTMLImageElement>('shot')
    img.src = shot
    img.hidden = false
    $('noshot').hidden = true
  } catch {
    // internal pages: no preview
  }
  $('saveImage').hidden = !st.ogImage
  if (st.pending) $('savePage').textContent = xt().popup.saveHere

  // ---- collections
  const list = $('collections')
  const render = (q: string) => {
    list.replaceChildren()
    const items = collections.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))
    for (const c of items) {
      const li = document.createElement('li')
      li.setAttribute('role', 'option')
      li.setAttribute('aria-selected', String(c.id === selected))
      const dot = document.createElement('span')
      dot.className = 'dot'
      dot.style.background = c.color ?? '#8e8e93'
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = c.name
      const count = document.createElement('span')
      count.className = 'count'
      count.textContent = String(c.count)
      li.append(dot, name, count)
      li.addEventListener('click', () => {
        selected = selected === c.id ? null : c.id
        render($<HTMLInputElement>('search').value)
      })
      list.appendChild(li)
    }
  }
  render('')
  $<HTMLInputElement>('search').addEventListener('input', (e) =>
    render((e.target as HTMLInputElement).value),
  )
  $('newCollection').addEventListener('click', () => {
    const name = window.prompt(xt().popup.newCollectionPrompt)?.trim()
    if (!name) return
    void send<{ collections: BridgeCollection[]; createdId?: string }>({
      type: 'popup:createCollection',
      name,
    }).then((r) => {
      collections = r.collections ?? collections
      selected = r.createdId ?? selected
      render('')
    })
  })

  // ---- saving
  const result = $('result')
  const save = async (mode: 'page' | 'image') => {
    for (const id of ['savePage', 'saveImage']) $<HTMLButtonElement>(id).disabled = true
    const ack = await send<{ status: string; error?: string; collectionName?: string }>({
      type: 'popup:save',
      mode,
      tabId: st.tab.id,
      title: $<HTMLInputElement>('title').value.trim() || null,
      collectionId: selected,
      note: $<HTMLTextAreaElement>('note').value.trim() || null,
    })
    result.hidden = false
    const ok = ack.status === 'saved' || ack.status === 'duplicate' || ack.status === 'queued'
    result.dataset.kind = ok ? 'ok' : 'error'
    const t = xt().toast
    result.textContent =
      ack.status === 'saved'
        ? ack.collectionName
          ? t.addedTo(ack.collectionName)
          : t.saved
        : ack.status === 'duplicate'
          ? t.duplicate
          : ack.status === 'queued'
            ? t.queued
            : t.failed(ack.error ?? t.error)
    if (ok) setTimeout(() => window.close(), 900)
    else for (const id of ['savePage', 'saveImage']) $<HTMLButtonElement>(id).disabled = false
  }
  $('savePage').addEventListener('click', () => void save('page'))
  $('saveImage').addEventListener('click', () => void save('image'))

  // ---- sync
  const sync = $('sync')
  sync.replaceChildren(
    ...BRIDGE_PLATFORMS.map((p) => {
      const div = document.createElement('div')
      div.textContent = syncLine(p, st)
      return div
    }),
  )
  $('syncNow').addEventListener('click', () => {
    void send({ type: 'popup:sync' }).then(() => {
      $('syncNow').textContent = xt().popup.syncRequested
    })
  })
  const missing = BRIDGE_PLATFORMS.filter((p) => st.platforms?.[p]?.permission === false)
  const grant = $('grant')
  grant.hidden = missing.length === 0
  grant.addEventListener('click', () => {
    const origins = missing.flatMap((p) => ENDPOINTS[p].permissions)
    // Must stay within the user gesture (Firefox).
    void api()
      .permissions.request({ origins })
      .then((ok) => {
        if (ok) {
          grant.hidden = true
          void send({ type: 'popup:statusChanged' })
        }
      })
  })
}

if (typeof document !== 'undefined' && document.getElementById('app')) void main()
