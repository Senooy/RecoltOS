/**
 * Panneau « Collections » du glisser (comportement observé sur la référence, fenêtre 1280×820) : dès
 * qu'une carte ou une sélection est glissée depuis une grille (Bibliothèque, vue Collection,
 * résultats de recherche), une carte flottante entre par la droite, sous l'en-tête, et liste
 * toutes les collections (arborescence légèrement indentée) : mini-pile des couvertures, nom,
 * nombre d'éléments. Déposer sur une ligne ajoute les éléments glissés (`addToCollection` : toast
 * « Ajouté à … · Annuler », ⌘Z, doublons ignorés). Le panneau repart à la fin du glisser.
 *
 * Le geste reste le glisser natif unifié (`lib/dnd.ts`) : `ui.internalDrag` ouvre le panneau, et
 * les `dragover` / `drop` HTML atteignent ses lignes comme ils atteignent la rangée de
 * collections. Le drapeau est effacé par `installInternalDragCleanup` (dépôt, Échap, pointeur).
 */
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { CollectionNode } from '../../../../shared/dto/collections'
import { motionSeconds, reduceMotionState, useReducedMotion } from '../../components/ui'
import { fr } from '../../i18n/fr'
import { cn } from '../../lib/cn'
import { flattenTree, useCollections } from '../../state/collections'
import { useUi, type RouteName } from '../../state/ui'
import { Cover } from '../library/CollectionsRow'
import { addToCollection } from './actions'

/** Écrans dont la grille lance le glisser (pas l'étagère ni les Spaces). */
const ROUTES: ReadonlySet<RouteName> = new Set(['library', 'collection', 'search'])
/** Entrée / sortie : glissement depuis la droite et fondu. */
const ENTER_MS = 200
const OFFSET_X = 28
/** Le panneau reste affiché un instant après un dépôt pour montrer le compteur mis à jour. */
export const LINGER_MS = 650
/** Défilement automatique : bande sensible en haut et en bas de la liste, vitesse max (px/image). */
const EDGE = 40
const MAX_SPEED = 14
/** Sans `dragover` depuis ce délai, le défilement s'arrête (pointeur sorti sans `dragleave`). */
const SCROLL_IDLE_MS = 120

const MINI_FAN = [
  'translateX(-3px) rotate(-4deg)',
  'translateX(3px) rotate(5deg)',
  'translateX(8px) rotate(10deg)',
]
const MINI_FAN_OPEN = [
  'translateX(-4px) translateY(-1px) rotate(-6deg)',
  'translateX(5px) rotate(8deg)',
  'translateX(11px) rotate(14deg)',
]

/** Mini-pile 36×36 des couvertures (même rendu que la rangée de collections). */
function MiniFan({ node, open }: { node: CollectionNode; open: boolean }) {
  const shown = node.covers.slice(0, 3)
  if (shown.length === 0) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center">
        <span className="h-[30px] w-6 rounded-[4px] border border-dashed border-[var(--border-dashed)]" />
      </span>
    )
  }
  return (
    <span
      className="relative block h-9 w-9 shrink-0 transition-transform duration-200 ease-[var(--ease-out)]"
      style={{ transform: open ? 'scale(1.08)' : undefined }}
    >
      {shown
        .map((c, i) => ({ c, i }))
        .reverse()
        .map(({ c, i }) => (
          <span
            key={c.uuid}
            className="absolute left-[5px] top-[2px] block h-8 w-[25px] overflow-hidden rounded-[4px] border border-[rgba(255,255,255,.9)]"
            style={{
              transform: (open ? MINI_FAN_OPEN : MINI_FAN)[i],
              transition: 'transform 220ms var(--ease-out)',
              boxShadow: 'var(--shadow-stack)',
            }}
          >
            <Cover card={c} tweetScale={25 / 300} />
          </span>
        ))}
    </span>
  )
}

interface Dropped {
  uuid: string
  /** Compteur au moment du dépôt (avant rechargement de l'arbre). */
  base: number
  /** Éléments réellement ajoutés (connu au retour de `collections.addItems`). */
  added: number | null
}

function Row({
  node,
  depth,
  hover,
  dropped,
}: {
  node: CollectionNode
  depth: number
  hover: boolean
  dropped: Dropped | null
}) {
  const optimistic =
    dropped?.uuid === node.uuid && dropped.added !== null && node.count === dropped.base
  const count = optimistic ? dropped.base + (dropped.added ?? 0) : node.count
  const justDropped = dropped?.uuid === node.uuid
  return (
    <li
      data-testid="drag-collection-row"
      data-uuid={node.uuid}
      data-drop-uuid={node.uuid}
      data-active={hover ? '1' : undefined}
      className={cn(
        'flex h-10 items-center gap-[9px] rounded-[10px] pr-[7px] transition-[background-color,box-shadow] duration-150',
        hover || justDropped ? 'bg-[var(--drag-panel-row-hover)]' : 'bg-transparent',
      )}
      style={{
        paddingLeft: 7 + depth * 14,
        boxShadow: hover ? 'inset 0 0 0 1px var(--drag-panel-row-ring)' : undefined,
      }}
    >
      <MiniFan node={node} open={hover || justDropped} />
      <span className="pointer-events-none min-w-0 flex-1 truncate text-ui font-semibold text-fg">
        {node.name}
      </span>
      <span
        data-testid="drag-collection-count"
        className="pointer-events-none shrink-0 text-caption tabular-nums text-fg-faint"
      >
        {count}
      </span>
    </li>
  )
}

export function CollectionsDragPanel() {
  const internalDrag = useUi((s) => s.internalDrag)
  const routeName = useUi((s) => s.route.name)
  const tree = useCollections((s) => s.tree)
  const reduced = useReducedMotion() || document.documentElement.dataset.e2e === '1'
  const [hover, setHover] = useState<string | null>(null)
  const [linger, setLinger] = useState(false)
  const [dropped, setDropped] = useState<Dropped | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const scroll = useRef({ v: 0, at: 0, raf: 0 })
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dragging = internalDrag !== null
  // Nouveau glisser : on repart d'un panneau neutre.
  useEffect(() => {
    if (!dragging) return
    if (lingerTimer.current) clearTimeout(lingerTimer.current)
    setLinger(false)
    setDropped(null)
    setHover(null)
  }, [dragging])

  const stopScroll = () => {
    if (scroll.current.raf) cancelAnimationFrame(scroll.current.raf)
    scroll.current.raf = 0
    scroll.current.v = 0
  }
  useEffect(
    () => () => {
      stopScroll()
      if (lingerTimer.current) clearTimeout(lingerTimer.current)
    },
    [],
  )
  useEffect(() => {
    if (!dragging) {
      stopScroll()
      setHover(null)
    }
  }, [dragging])

  const tick = () => {
    const s = scroll.current
    const list = listRef.current
    if (!list || s.v === 0 || performance.now() - s.at > SCROLL_IDLE_MS) {
      s.raf = 0
      return
    }
    list.scrollTop += s.v
    s.raf = requestAnimationFrame(tick)
  }

  const rowAt = (e: DragEvent): string | null => {
    const el = (e.target as Element | null)?.closest?.('[data-drop-uuid]')
    return el?.getAttribute('data-drop-uuid') ?? null
  }

  const onDragOver = (e: DragEvent<HTMLUListElement>) => {
    if (!useUi.getState().internalDrag) return
    const list = listRef.current
    if (list) {
      const r = list.getBoundingClientRect()
      let v = 0
      if (e.clientY < r.top + EDGE) v = -((r.top + EDGE - e.clientY) / EDGE) * MAX_SPEED
      else if (e.clientY > r.bottom - EDGE) v = ((e.clientY - (r.bottom - EDGE)) / EDGE) * MAX_SPEED
      const s = scroll.current
      s.v = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, Math.round(v)))
      s.at = performance.now()
      if (s.v !== 0 && !s.raf) s.raf = requestAnimationFrame(tick)
    }
    const uuid = rowAt(e)
    setHover(uuid)
    if (!uuid) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onDragLeave = (e: DragEvent<HTMLElement>) => {
    const r = panelRef.current?.getBoundingClientRect()
    const inside =
      r && e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom
    if (!inside) {
      setHover(null)
      stopScroll()
    }
  }

  const onDrop = (e: DragEvent<HTMLUListElement>) => {
    const ids = useUi.getState().internalDrag
    const uuid = rowAt(e)
    stopScroll()
    setHover(null)
    if (!ids || !uuid) return
    const node = flattenTree(useCollections.getState().tree).find((f) => f.node.uuid === uuid)?.node
    if (!node) return
    e.preventDefault()
    // `internalDrag` est effacé après la propagation (capture de la fenêtre) : le calque de dépôt
    // n'importe pas les originaux du glisser natif.
    setDropped({ uuid, base: node.count, added: null })
    setLinger(true)
    if (lingerTimer.current) clearTimeout(lingerTimer.current)
    lingerTimer.current = setTimeout(() => setLinger(false), LINGER_MS)
    void addToCollection({ uuid: node.uuid, name: node.name }, ids).then((added) =>
      setDropped((d) => (d?.uuid === uuid ? { ...d, added } : d)),
    )
  }

  const open = ROUTES.has(routeName) && (dragging || linger)
  const rows = flattenTree(tree)
  const hidden = reduceMotionState({ opacity: 0, x: OFFSET_X }, reduced)
  const transition = {
    duration: motionSeconds(ENTER_MS, reduced),
    ease: [0.22, 1, 0.36, 1] as const,
  }
  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          key="drag-collections"
          ref={panelRef}
          data-testid="drag-collections-panel"
          aria-label={fr.gridUi.dragPanelLabel}
          className="fixed bottom-[90px] right-0 top-[91px] z-[60] flex w-[230px] flex-col rounded-l-[14px] bg-[var(--drag-panel-bg)]"
          style={{
            boxShadow: 'var(--drag-panel-shadow)',
            pointerEvents: dragging ? undefined : 'none',
          }}
          initial={hidden}
          animate={{ opacity: 1, x: 0 }}
          exit={hidden}
          transition={transition}
          onDragLeave={onDragLeave}
        >
          <div className="shrink-0 px-4 pb-[6px] pt-[10px] text-micro font-medium uppercase tracking-[0.08em] text-fg-subtle">
            {fr.gridUi.dragPanelTitle}
          </div>
          {rows.length === 0 ? (
            <div className="px-4 py-2 text-small text-fg-faint">{fr.collectionUi.pickerEmpty}</div>
          ) : (
            <ul
              ref={listRef}
              data-testid="drag-collections-list"
              className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-[6px] pb-2"
              onDragOver={onDragOver}
              onDrop={onDrop}
            >
              {rows.map(({ node, depth }) => (
                <Row
                  key={node.uuid}
                  node={node}
                  depth={depth}
                  hover={hover === node.uuid}
                  dropped={dropped}
                />
              ))}
            </ul>
          )}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}
