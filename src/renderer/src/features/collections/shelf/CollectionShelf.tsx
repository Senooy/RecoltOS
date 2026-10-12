/**
 * 3D shelf of collections: full-frame black background + `Starfield`, labels at y≈104 in steps
 * of 122 px from x≈150, `.cover-face` covers 410×700 in `rotateY(-35deg)` (`large` media, text
 * post in a white `TweetCard cover`, muted looping `preview` video: ONE at a time, that of the
 * hovered cover or, failing that, the one closest to the centre, and none during the cascade
 * entrance; never the original). Only one: as soon as two videos play on screen, Chromium aligns
 * the display on their rate (30 Hz, the compositor's "video call" heuristic), and the drop of the
 * slices as well as their hover fall to one frame in four on a 120 Hz screen.
 * Cascade entrance (the slices fall one by one, `--i` = rank) and hover that pulls the slice out
 * along its axis: see `shelf.css`. Wheel (vertical or horizontal) → inertial scrolling of the
 * track; ←/→ move from one cover to the next, ↵ opens, Esc returns to the Library (⌘1 goes
 * through the menu). End of track: outline cover "+ New collection". Reduced motion: static
 * shelf (no inertia, no flicker, no video).
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
import { tr } from '../../../i18n'
import { mediaSrc } from '../../../lib/media-url'
import { RpcError, rpc } from '../../../lib/rpc'
import { isEditableTarget } from '../../../lib/shortcuts'
import { releaseOnUnmount } from '../../../lib/video-guard'
import { useCollections } from '../../../state/collections'
import { askName } from '../../../state/dialogs'
import { useUi } from '../../../state/ui'
import { TweetCard } from '../../grid/cards/TweetCard'
import { Starfield } from './Starfield'
import '../../../styles/shelf.css'

/** Geometry. */
export const SHELF_PAD_LEFT = 152
export const SHELF_STEP = 122
export const SHELF_LABEL_X = 150
export const SHELF_LABEL_Y = 104
/** Videos played at the same time (see the header: beyond one, the display drops to 30 Hz). */
export const MAX_PLAYING = 1

/** Duration of the cascade entrance (`shelf.css`: `--i` × 45 ms capped at 18, 560 ms fall). */
export function entranceMs(count: number): number {
  return Math.min(Math.max(0, count - 1), 18) * 45 + 560
}

/** Indices of the videos to play: at most `max`, the closest to the centre of the window. */
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
        ref={releaseOnUnmount}
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
  // Captures and tests (RECOLTOS_E2E): shelf frozen, as with reduced motion.
  const reduced = useReducedMotion() || document.documentElement.dataset.e2e === '1'
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(1280)
  const [scroll, setScroll] = useState(0)
  const target = useRef(0)
  const current = useRef(0)
  const raf = useRef(0)
  const [active, setActive] = useState<number | null>(null)
  // No video during the cascade: it starts once the slices have landed.
  const [landed, setLanded] = useState(false)
  const coverRefs = useRef<(HTMLButtonElement | null)[]>([])

  const count = tree.length + 1 // + "New collection" cover
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

  /** Brings cover `i` into the window (comfortable margin on each side). */
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
      title: tr.collection.new,
      initial: '',
      confirmLabel: tr.shell.create,
    })
    if (!name) return
    try {
      await rpc('collections.create', { name })
    } catch (err) {
      toast(err instanceof RpcError ? err.message : tr.errors.generic)
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

  useEffect(() => {
    if (reduced) return
    const id = window.setTimeout(() => setLanded(true), entranceMs(count) + 60)
    return () => window.clearTimeout(id)
    // Once, on mount: the cascade does not replay when the tree changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced])

  const covers = useMemo(() => tree.map((n) => n.covers[0]), [tree])
  const playing = useMemo(() => {
    if (reduced || !landed) return new Set<number>()
    const isVideo = covers.map((c) => c?.kind === 'video' && c.previewUrl !== null)
    // The hovered (or focused) cover plays its video alone; otherwise the closest to the centre.
    if (active !== null && isVideo[active]) return new Set([active])
    return playingIndices(isVideo, scroll, viewport)
  }, [covers, scroll, viewport, reduced, landed, active])

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
            <div className="shelf-label-count">{tr.count.items(node.count)}</div>
          </div>
        ))}
      </div>
      <div
        className="shelf-track"
        role="list"
        aria-label={tr.nav.collections}
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
            aria-label={`${node.name}, ${tr.count.items(node.count)}`}
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
          aria-label={tr.collection.new}
          data-active={active === tree.length ? '1' : undefined}
          className="shelf-cover"
          style={{ '--i': tree.length } as CSSProperties}
          onMouseEnter={() => setActive(tree.length)}
          onFocus={() => setActive(tree.length)}
          onClick={() => void createCollection()}
        >
          <span className="cover-face cover-face-new" />
          {/* Label laid flat on the visible slot (the text of an empty 3D face is not painted). */}
          <span className="shelf-new-label pointer-events-none absolute inset-y-0 left-0 right-0 flex flex-col items-center justify-center gap-2 px-2 text-center text-[13px] font-medium leading-4 text-[rgba(255,255,255,.55)]">
            <Plus size={24} strokeWidth={1.5} />
            {tr.collection.new}
          </span>
        </button>
      </div>
    </div>
  )
}
