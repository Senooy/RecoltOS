/**
 * Étagère 3D des collections (DESIGN §3.4, WP-21) : fond noir plein cadre + `Starfield`, libellés
 * à y≈104 au pas de 122 px depuis x≈150, couvertures `.cover-face` 410×700 en `rotateY(-35deg)`
 * (média `large`, post texte en `TweetCard cover` blanche, vidéos `preview` muettes en boucle : au
 * plus 4, les plus proches du centre, plus la couverture survolée ; jamais l'original). Entrée en
 * cascade (les tranches tombent une à une, `--i` = rang) et survol qui fait sortir la tranche dans
 * son axe : voir `shelf.css`. Molette (verticale ou horizontale) →
 * défilement inertiel de la piste ; ←/→ passent d'une couverture à l'autre, ↵ ouvre, Échap revient
 * à la Bibliothèque (⌘1 passe par le menu). Fin de piste : couverture-contour « + Nouvelle
 * collection ». Mouvement réduit : étagère statique (pas d'inertie, ni scintillement, ni vidéo).
 */
import { Plus } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type WheelEvent,
} from 'react'
import type { CollectionNode } from '../../../../../shared/dto/collections'
import type { ItemCard } from '../../../../../shared/dto/items'
import { toast, useReducedMotion } from '../../../components/ui'
import { fr } from '../../../i18n/fr'
import { mediaSrc } from '../../../lib/media-url'
import { RpcError, rpc } from '../../../lib/rpc'
import { isEditableTarget } from '../../../lib/shortcuts'
import { useCollections } from '../../../state/collections'
import { askName } from '../../../state/dialogs'
import { useUi } from '../../../state/ui'
import { TweetCard } from '../../grid/cards/TweetCard'
import { Starfield } from './Starfield'
import '../../../styles/shelf.css'

/** Géométrie (DESIGN §3.4). */
export const SHELF_PAD_LEFT = 152
export const SHELF_STEP = 122
export const SHELF_LABEL_X = 150
export const SHELF_LABEL_Y = 104
export const MAX_PLAYING = 4

/** Indices des vidéos à lire : au plus `max`, les plus proches du centre de la fenêtre. */
export function playingIndices(
  isVideo: readonly boolean[],
  scroll: number,
  viewport: number,
  max = MAX_PLAYING,
): Set<number> {
  const center = viewport / 2
  return new Set(
    isVideo
      .map((v, i) => ({
        v,
        i,
        d: Math.abs(SHELF_PAD_LEFT + SHELF_STEP * (i + 0.5) - scroll - center),
      }))
      .filter((x) => x.v)
      .sort((a, b) => a.d - b.d)
      .slice(0, max)
      .map((x) => x.i),
  )
}

function CoverContent({ card, play }: { card: ItemCard | undefined; play: boolean }) {
  if (!card) return null
  if (card.kind === 'tweet') {
    return (
      <div className="absolute inset-0 overflow-hidden bg-white">
        <TweetCard
          card={card}
          variant="cover"
          className="absolute right-0 top-0 rounded-none border-0"
          style={{ transform: 'scale(1.7)', transformOrigin: 'top right' }}
        />
      </div>
    )
  }
  const poster = mediaSrc(card.largeUrl ?? card.posterUrl ?? card.thumbUrl)
  if (card.kind === 'video' && play && card.previewUrl) {
    return (
      <video
        data-testid="shelf-video"
        src={mediaSrc(card.previewUrl)}
        poster={poster}
        muted
        loop
        autoPlay
        playsInline
        crossOrigin="anonymous"
      />
    )
  }
  return poster ? (
    <img src={poster} alt="" draggable={false} decoding="async" crossOrigin="anonymous" />
  ) : null
}

export default function CollectionShelf() {
  const tree = useCollections((s) => s.tree)
  const navigate = useUi((s) => s.navigate)
  // Captures et tests (RECOLTOS_E2E) : étagère figée, comme en mouvement réduit.
  const reduced = useReducedMotion() || document.documentElement.dataset.e2e === '1'
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(1280)
  const [scroll, setScroll] = useState(0)
  const target = useRef(0)
  const current = useRef(0)
  const raf = useRef(0)
  const [active, setActive] = useState<number | null>(null)
  const coverRefs = useRef<(HTMLButtonElement | null)[]>([])

  const count = tree.length + 1 // + couverture « Nouvelle collection »
  const maxScroll = Math.max(0, SHELF_PAD_LEFT + SHELF_STEP * count + 120 - viewport)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewport(el.clientWidth))
    ro.observe(el)
    setViewport(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const scrollTo = useCallback(
    (x: number) => {
      target.current = Math.min(maxScroll, Math.max(0, x))
      if (reduced) {
        current.current = target.current
        setScroll(target.current)
        return
      }
      if (raf.current) return
      const step = () => {
        const d = target.current - current.current
        current.current = Math.abs(d) < 0.5 ? target.current : current.current + d * 0.16
        setScroll(current.current)
        raf.current = current.current === target.current ? 0 : requestAnimationFrame(step)
      }
      raf.current = requestAnimationFrame(step)
    },
    [maxScroll, reduced],
  )
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const onWheel = (e: WheelEvent) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    scrollTo(target.current + delta)
  }

  /** Amène la couverture `i` dans la fenêtre (marge confortable de chaque côté). */
  const reveal = useCallback(
    (i: number) => {
      const left = SHELF_PAD_LEFT + SHELF_STEP * i - 180
      const right = SHELF_PAD_LEFT + SHELF_STEP * (i + 1) + 120 - viewport
      if (target.current > left) scrollTo(left)
      else if (target.current < right) scrollTo(right)
    },
    [scrollTo, viewport],
  )

  const focusCover = useCallback(
    (i: number) => {
      const n = Math.max(0, Math.min(count - 1, i))
      setActive(n)
      reveal(n)
      coverRefs.current[n]?.focus({ preventScroll: true })
    },
    [count, reveal],
  )

  const createCollection = async () => {
    const name = await askName({
      title: fr.collection.new,
      initial: '',
      confirmLabel: fr.shell.create,
    })
    if (!name) return
    try {
      await rpc('collections.create', { name })
    } catch (err) {
      toast(err instanceof RpcError ? err.message : fr.errors.generic)
    }
  }

  const open = useCallback(
    (i: number) => {
      const node = tree[i]
      if (node) navigate({ name: 'collection', uuid: node.uuid })
      else void createCollection()
    },

    [tree, navigate],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().overlay || isEditableTarget(e.target)) return
      if (e.metaKey || e.altKey || e.ctrlKey) return
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        const base = active ?? -1
        focusCover(e.key === 'ArrowRight' ? base + 1 : Math.max(0, base - 1))
      } else if (e.key === 'Enter' && active !== null) {
        e.preventDefault()
        open(active)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        navigate({ name: 'library' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, focusCover, open, navigate])

  const covers = useMemo(() => tree.map((n) => n.covers[0]), [tree])
  const playing = useMemo(() => {
    if (reduced) return new Set<number>()
    const isVideo = covers.map((c) => c?.kind === 'video' && c.previewUrl !== null)
    const set = playingIndices(isVideo, scroll, viewport)
    // La couverture survolée (ou focalisée) joue toujours sa vidéo.
    if (active !== null && isVideo[active]) set.add(active)
    return set
  }, [covers, scroll, viewport, reduced, active])

  return (
    <div
      ref={rootRef}
      data-testid="shelf"
      className="shelf-root shelf absolute inset-0 -top-24 z-0 select-none"
      onWheel={onWheel}
    >
      <Starfield parallax={maxScroll > 0 ? scroll / maxScroll : 0} still={reduced} />
      <div
        className="absolute left-0 top-0"
        style={{ transform: `translate3d(${-scroll}px, 0, 0)` }}
        aria-hidden="true"
      >
        {tree.map((node, i) => (
          <div
            key={node.uuid}
            className="shelf-label"
            data-testid="shelf-label"
            data-active={active === i ? '1' : undefined}
            style={
              {
                left: SHELF_LABEL_X + SHELF_STEP * i,
                top: SHELF_LABEL_Y,
                '--i': i,
              } as CSSProperties
            }
          >
            <div className="shelf-label-name">{node.name}</div>
            <div className="shelf-label-count">{fr.count.items(node.count)}</div>
          </div>
        ))}
      </div>
      <div
        className="shelf-track"
        role="list"
        aria-label={fr.nav.collections}
        style={{ transform: `translate3d(${-scroll}px, 0, 0)` }}
      >
        {tree.map((node: CollectionNode, i) => (
          <button
            key={node.uuid}
            ref={(el) => {
              coverRefs.current[i] = el
            }}
            type="button"
            role="listitem"
            data-testid="shelf-cover"
            data-name={node.name}
            data-uuid={node.uuid}
            data-active={active === i ? '1' : undefined}
            aria-label={`${node.name}, ${fr.count.items(node.count)}`}
            className="shelf-cover"
            style={{ '--i': i } as CSSProperties}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive((a) => (a === i ? null : a))}
            onFocus={() => setActive(i)}
            onClick={() => open(i)}
          >
            <span className="cover-face">
              <CoverContent card={covers[i]} play={playing.has(i)} />
            </span>
          </button>
        ))}
        <button
          ref={(el) => {
            coverRefs.current[tree.length] = el
          }}
          type="button"
          role="listitem"
          data-testid="shelf-new"
          aria-label={fr.collection.new}
          data-active={active === tree.length ? '1' : undefined}
          className="shelf-cover"
          style={{ '--i': tree.length } as CSSProperties}
          onMouseEnter={() => setActive(tree.length)}
          onFocus={() => setActive(tree.length)}
          onClick={() => void createCollection()}
        >
          <span className="cover-face cover-face-new" />
          {/* Libellé à plat sur le créneau visible (le texte d'une face 3D vide n'est pas peint). */}
          <span className="shelf-new-label pointer-events-none absolute inset-y-0 left-0 right-0 flex flex-col items-center justify-center gap-2 px-2 text-center text-[13px] font-medium leading-4 text-[rgba(255,255,255,.55)]">
            <Plus size={24} strokeWidth={1.5} />
            {fr.collection.new}
          </span>
        </button>
      </div>
    </div>
  )
}
