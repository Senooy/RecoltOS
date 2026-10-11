/**
 * Popup 360×520 (SYNC §2.3, tutoiement) : état du pont, aperçu, enregistrement de la page ou de
 * l'image principale, collection, note, état de la synchro par plateforme et « Synchroniser
 * maintenant ». Firefox : bouton « Autoriser l'accès aux sites » si les autorisations d'hôte
 * (optionnelles en MV3) manquent.
 */
import { BRIDGE_PLATFORMS, type BridgePlatform } from '../../../src/shared/bridge/constants'
import type { BridgeCollection } from '../../../src/shared/bridge/save'
import { api } from '../lib/api'
import { ENDPOINTS } from '../lib/endpoints'
import type { PopupRequest, PopupState } from '../lib/popup-protocol'

export const STATUS_TEXT: Record<string, { label: string; hint?: string }> = {
  connecting: { label: 'Connexion…' },
  app_connected: { label: 'Connecté à RecoltOS' },
  app_closed: {
    label: 'RecoltOS fermé',
    hint: 'Tes enregistrements seront ajoutés au prochain lancement de RecoltOS.',
  },
  host_missing: {
    label: 'Connecteur absent',
    hint: 'Ouvre RecoltOS une fois pour installer le connecteur, puis rouvre ce panneau.',
  },
  host_forbidden: {
    label: 'Connecteur refusé',
    hint: 'Réinstalle le connecteur depuis RecoltOS › Réglages › Synchronisation.',
  },
  host_exited: {
    label: 'RecoltOS introuvable',
    hint: 'Le connecteur s’est arrêté. Vérifie que RecoltOS est installé, puis rouvre ce panneau.',
  },
  protocol_mismatch: {
    label: 'Mise à jour nécessaire',
    hint: 'L’extension et RecoltOS ne parlent pas la même version : mets-les à jour.',
  },
  stale: {
    label: 'Extension à recharger',
    hint: 'Ton extension est plus ancienne que celle fournie avec RecoltOS : retire-la puis charge le dossier RecoltOS.',
  },
}

const NAMES: Record<BridgePlatform, string> = { x: 'X', instagram: 'Instagram', cosmos: 'Cosmos' }

/** « il y a 4 min », « il y a 2 h », « hier »… */
export function relTime(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return 'à l’instant'
  const m = Math.round(s / 60)
  if (m < 60) return `il y a ${m}\u00a0min`
  const h = Math.round(m / 60)
  if (h < 24) return `il y a ${h}\u00a0h`
  const d = Math.round(h / 24)
  return d === 1 ? 'hier' : `il y a ${d}\u00a0jours`
}

export function syncLine(p: BridgePlatform, st: PopupState, now = Date.now()): string {
  const plat = st.platforms?.[p]
  const sync = st.sync?.[p]
  if (plat && plat.permission === false) return `${NAMES[p]} — accès au site à autoriser`
  if (sync && !sync.enabled) return `${NAMES[p]} — désactivé dans RecoltOS`
  if (plat && !plat.loggedIn) return `${NAMES[p]} — non connecté dans ce navigateur`
  if (sync?.lastSuccessAt != null)
    return `${NAMES[p]} — dernière synchro ${relTime(sync.lastSuccessAt, now)}`
  return `${NAMES[p]} — connecté`
}

function send<T>(msg: PopupRequest): Promise<T> {
  return api().runtime.sendMessage(msg)
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

async function main(): Promise<void> {
  const st = await send<PopupState>({ type: 'popup:state' })
  let selected: string | null = st.lastCollectionId
  let collections: BridgeCollection[] = st.collections

  // ---- état
  const key = st.stale ? 'stale' : st.bridge
  const status = STATUS_TEXT[key] ?? STATUS_TEXT.connecting!
  const pill = $('status')
  pill.dataset.state = key
  pill.querySelector('span')!.textContent = status.label
  const hint = $('statusHint')
  hint.hidden = !status.hint
  hint.textContent = status.hint ?? ''

  // ---- aperçu
  $<HTMLInputElement>('title').value = st.tab.title ?? ''
  try {
    const shot = await api().tabs.captureVisibleTab({ format: 'jpeg', quality: 70 })
    const img = $<HTMLImageElement>('shot')
    img.src = shot
    img.hidden = false
    $('noshot').hidden = true
  } catch {
    // pages internes : pas d'aperçu
  }
  $('saveImage').hidden = !st.ogImage
  if (st.pending) $('savePage').textContent = 'Enregistrer ici'

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
    const name = window.prompt('Nom de la nouvelle collection')?.trim()
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

  // ---- enregistrement
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
    result.textContent =
      ack.status === 'saved'
        ? ack.collectionName
          ? `Ajouté à ${ack.collectionName}`
          : 'Enregistré dans RecoltOS'
        : ack.status === 'duplicate'
          ? 'Déjà dans ta bibliothèque'
          : ack.status === 'queued'
            ? 'RecoltOS est fermé : ajouté au prochain lancement'
            : `Enregistrement impossible : ${ack.error ?? 'erreur'}`
    if (ok) setTimeout(() => window.close(), 900)
    else for (const id of ['savePage', 'saveImage']) $<HTMLButtonElement>(id).disabled = false
  }
  $('savePage').addEventListener('click', () => void save('page'))
  $('saveImage').addEventListener('click', () => void save('image'))

  // ---- synchro
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
      $('syncNow').textContent = 'Synchronisation demandée'
    })
  })
  const missing = BRIDGE_PLATFORMS.filter((p) => st.platforms?.[p]?.permission === false)
  const grant = $('grant')
  grant.hidden = missing.length === 0
  grant.addEventListener('click', () => {
    const origins = missing.flatMap((p) => ENDPOINTS[p].permissions)
    // Doit rester dans le geste de l'utilisateur (Firefox).
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
