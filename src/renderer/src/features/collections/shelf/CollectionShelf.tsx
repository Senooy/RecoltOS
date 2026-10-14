/**
 * 3D shelf of collections: full-frame black background + `Starfield`, labels at y≈104 in steps
 * of 122 px from x≈150, covers 410×700 in `rotateY(-35deg)` (image sized for the face: the
 * 800 px thumbnail when it covers the face at 2×, otherwise `large`; text post in a white
 * `TweetCard cover`; muted looping `preview` video for video covers, never the original).
 *
 * Performance contract (120 Hz):
 *  - No React render per frame or per hover: hover is pure CSS (`:hover` on the slot, sibling
 *    layers), scrolling writes the track `transform` (and the star parallax) from a rAF through
 *    refs, the keyboard state is a `data-active` written on the item. The items are memoized.
 *  - Entry: the covers of the slices visible at entry are decoded (`img.decode()`, capped) BEFORE
 *    the cascade starts (`data-phase` wait → enter → rest): no image arriving, and no raster,
 *    during the fall. The slices outside the window do not fall, they are in place.
 *  - Videos: ALL the visible video covers play together once the slices have landed (none during
 *    the entry; off-window ones paused; all paused when the window is hidden or in the background
 *    or an overlay covers the shelf). They are never composited as `<video>` (two composited
 *    videos pin the display to their 30 Hz): see `shelf-videos.ts`, frames copied into a canvas.
 *  - Compositing, entry and hover animations: see `shelf.css` (transform/opacity only).
 *
 * Wheel (vertical or horizontal) → inertial scrolling of the track; ←/→ move from one cover to
 * the next, ↵ opens, Esc returns to the Library (⌘1 goes through the menu). End of track:
 * outline cover "+ New collection". Reduced motion: static shelf (no inertia, no drop, no video).
 */
import { Plus } from 'lucide-react'
import {
  memo,
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
import { useCollections } from '../../../state/collections'
import { askName } from '../../../state/dialogs'
import { useUi } from '../../../state/ui'
import { TweetCard } from '../../grid/cards/TweetCard'
import { ShelfVideos, VIDEO_CANVAS_H, VIDEO_CANVAS_W, visibleSlots } from './shelf-videos'
import { Starfield, type StarfieldHandle } from './Starfield'
import '../../../styles/shelf.css'

/** Geometry. */
export const SHELF_PAD_LEFT = 152
export const SHELF_STEP = 122
export const SHELF_LABEL_X = 150
export const SHELF_LABEL_Y = 104
/** Face of a cover (CSS px). */
export const FACE_W = 410
export const FACE_H = 700
/** Maximum wait for the covers' decoding before the cascade starts anyway. */
const DECODE_CAP_MS = 350
/** Width of the `thumb` derivative. */
const THUMB_W = 800

/** Duration of the cascade entrance (`shelf.css`: `--i` × 45 ms capped at 18, 560 ms fall). */
export function entranceMs(count: number): number {
  return Math.min(Math.max(0, count - 1), 18) * 45 + 560
}

/** Slices that fall at entry: those whose slot is (even partly) in the window. */
export function animatedCount(viewport: number, count = Number.MAX_SAFE_INTEGER): number {
  return Math.min(count, Math.max(1, Math.ceil((viewport - SHELF_PAD_LEFT) / SHELF_STEP) + 1))
}

/** End of the track (the "New collection" cover included in `count`). */
function maxScrollFor(count: number, viewport: number): number {
  return Math.max(0, SHELF_PAD_LEFT + SHELF_STEP * count + 120 - viewport)
}

const DERIVED_THUMB = /\/thumbs\/[^/]+\/[^/?]+\.webp(\?|$)/

/**
 * Texture of a face, sized for it: the 800 px `thumb` when it covers the 410×700 face at 2×
 * (portrait sources, `object-fit: cover`), otherwise `large` (1440 px); never the original.
 */
export function faceSrc(
  card: Pick<ItemCard, 'width' | 'height' | 'thumbUrl' | 'largeUrl' | 'posterUrl'>,
): string | undefined {
  const tallEnough =
    card.width !== null &&
    card.height !== null &&
    (THUMB_W * card.height) / card.width >= FACE_H * 2 * 0.9 &&
    card.thumbUrl !== null &&
    DERIVED_THUMB.test(card.thumbUrl)
  return mediaSrc(
    (tallEnough ? card.thumbUrl : null) ?? card.largeUrl ?? card.posterUrl ?? card.thumbUrl,
  )
}

/** Stable handlers shared by every item (they read the shelf's refs). */
interface ItemHandlers {
  enter: (i: number) => void
  leave: (i: number) => void
  focus: (i: number, el: HTMLElement) => void
  blur: (i: number) => void
  click: (i: number) => void
  item: (i: number, el: HTMLDivElement | null) => void
  slot: (i: number, el: HTMLButtonElement | null) => void
}

/** Face content, painted once in the face layer (never re-rendered by hover or video). */
const FaceContent = memo(function FaceContent({ card }: { card: ItemCard | undefined }) {
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
  const src = faceSrc(card)
  // `sync`: never drawn without its image (no image arriving mid-fall); decoded before the entry.
  return src ? (
    <img src={src} alt="" draggable={false} decoding="sync" crossOrigin="anonymous" />
  ) : null
})

const ShelfItem = memo(function ShelfItem({
  index,
  node,
  card,
  animate,
  videos,
  handlers,
}: {
  index: number
  node: CollectionNode
  card: ItemCard | undefined
  animate: boolean
  videos: ShelfVideos
  handlers: ItemHandlers
}) {
  const preview = card?.kind === 'video' ? mediaSrc(card.previewUrl) : undefined
  // React 19 ref callback with cleanup: the canvas is registered as long as it is mounted.
  const videoCanvas = useCallback(
    (el: HTMLCanvasElement | null) =>
      el && preview ? videos.register(index, el, preview) : undefined,
    [videos, index, preview],
  )
  const count = tr.count.items(node.count)
  return (
    <div
      ref={(el) => handlers.item(index, el)}
      className="shelf-item"
      data-anim={animate ? '' : undefined}
      style={{ '--i': index } as CSSProperties}
    >
      <button
        ref={(el) => handlers.slot(index, el)}
        type="button"
        role="listitem"
        data-testid="shelf-cover"
        data-name={node.name}
        data-uuid={node.uuid}
        aria-label={`${node.name}, ${count}`}
        className="shelf-slot"
        onMouseEnter={() => handlers.enter(index)}
        onMouseLeave={() => handlers.leave(index)}
        onFocus={(e) => handlers.focus(index, e.currentTarget)}
        onBlur={() => handlers.blur(index)}
        onClick={() => handlers.click(index)}
      />
      <span className="cover-layer cover-face" aria-hidden="true">
        <FaceContent card={card} />
      </span>
      {preview ? (
        <canvas
          ref={videoCanvas}
          className="cover-layer cover-canvas"
          width={VIDEO_CANVAS_W}
          height={VIDEO_CANVAS_H}
          aria-hidden="true"
        />
      ) : null}
      <span className="cover-layer cover-veil" aria-hidden="true" />
      <span className="cover-layer cover-edge" aria-hidden="true" />
      <div className="shelf-label" data-testid="shelf-label" aria-hidden="true">
        <div className="shelf-label-name">
          <span className="shelf-label-lo">{node.name}</span>
          <span className="shelf-label-hi">{node.name}</span>
        </div>
        <div className="shelf-label-count">{count}</div>
      </div>
    </div>
  )
})

const NewItem = memo(function NewItem({
  index,
  animate,
  handlers,
}: {
  index: number
  animate: boolean
  handlers: ItemHandlers
}) {
  return (
    <div
      ref={(el) => handlers.item(index, el)}
      className="shelf-item"
      data-anim={animate ? '' : undefined}
      style={{ '--i': index } as CSSProperties}
    >
      <button
        ref={(el) => handlers.slot(index, el)}
        type="button"
        role="listitem"
        data-testid="shelf-new"
        aria-label={tr.collection.new}
        className="shelf-slot"
        onMouseEnter={() => handlers.enter(index)}
        onMouseLeave={() => handlers.leave(index)}
        onFocus={(e) => handlers.focus(index, e.currentTarget)}
        onBlur={() => handlers.blur(index)}
        onClick={() => handlers.click(index)}
      />
      <span className="cover-layer cover-face cover-face-new" aria-hidden="true" />
      {/* Label laid flat on the visible slot. */}
      <span className="shelf-new-label flex flex-col items-center justify-center gap-2 px-2 text-center text-[13px] font-medium leading-4 text-[rgba(255,255,255,.55)]">
        <Plus size={24} strokeWidth={1.5} />
        {tr.collection.new}
      </span>
    </div>
  )
})

type Phase = 'wait' | 'enter' | 'rest'

export default function CollectionShelf() {
  const tree = useCollections((s) => s.tree)
  const navigate = useUi((s) => s.navigate)
  // Captures and tests (RECOLTOS_E2E): shelf frozen, as with reduced motion.
  const reduced = useReducedMotion() || document.documentElement.dataset.e2e === '1'
  const rootRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const unveilRef = useRef<HTMLDivElement | null>(null)
  const starsRef = useRef<StarfieldHandle | null>(null)
  const viewport = useRef(window.innerWidth)
  const target = useRef(0)
  const current = useRef(0)
  const raf = useRef(0)
  /** Hovered or keyboard-focused cover (no React state: hover is CSS). */
  const active = useRef<number | null>(null)
  /** Cover carrying `data-active` (keyboard focus). */
  const marked = useRef<number | null>(null)
  const itemEls = useRef<(HTMLDivElement | null)[]>([])
  const slotEls = useRef<(HTMLButtonElement | null)[]>([])
  const [phase, setPhase] = useState<Phase>(() => (reduced ? 'enter' : 'wait'))
  const videos = useMemo(() => new ShelfVideos(), [])
  useEffect(() => () => videos.destroy(), [videos])

  const count = tree.length + 1 // + "New collection" cover
  // Slots visible at entry (fixed at mount: the cascade does not replay); those slices fall.
  const [animated] = useState(() => animatedCount(window.innerWidth))

  const treeRef = useRef(tree)
  treeRef.current = tree
  const countRef = useRef(count)
  countRef.current = count
  const covers = useMemo(() => tree.map((n) => n.covers[0]), [tree])

  /** Videos of the slices in the window play (the others pause). */
  const updateVisible = useCallback(() => {
    videos.setVisible(
      visibleSlots(current.current, viewport.current, countRef.current, SHELF_PAD_LEFT, SHELF_STEP),
    )
  }, [videos])

  /** Writes the scroll position: track transform + vanishing point + star parallax. */
  const applyScroll = useCallback((x: number) => {
    const track = trackRef.current
    if (track) {
      track.style.transform = `translate3d(${-x}px, 0, 0)`
      track.style.perspectiveOrigin = `calc(50% + ${x}px) 50%`
    }
    const max = maxScrollFor(countRef.current, viewport.current)
    starsRef.current?.setParallax(max > 0 ? x / max : 0)
  }, [])

  const scrollTo = useCallback(
    (x: number) => {
      target.current = Math.min(maxScrollFor(countRef.current, viewport.current), Math.max(0, x))
      if (reduced) {
        current.current = target.current
        applyScroll(current.current)
        updateVisible()
        return
      }
      if (raf.current) return
      const step = () => {
        const d = target.current - current.current
        current.current = Math.abs(d) < 0.5 ? target.current : current.current + d * 0.16
        applyScroll(current.current)
        if (current.current === target.current) {
          raf.current = 0
          // At rest: the set of slices in the window may have changed.
          updateVisible()
        } else raf.current = requestAnimationFrame(step)
      }
      raf.current = requestAnimationFrame(step)
    },
    [reduced, applyScroll, updateVisible],
  )
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      viewport.current = el.clientWidth
      // Keeps the position within bounds and the vanishing point centred.
      target.current = current.current = Math.min(
        maxScrollFor(countRef.current, viewport.current),
        current.current,
      )
      applyScroll(current.current)
      updateVisible()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [applyScroll, updateVisible])

  const onWheel = (e: WheelEvent) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    scrollTo(target.current + delta)
  }

  /** Brings cover `i` into the window (comfortable margin on each side). */
  const reveal = useCallback(
    (i: number) => {
      const left = SHELF_PAD_LEFT + SHELF_STEP * i - 180
      const right = SHELF_PAD_LEFT + SHELF_STEP * (i + 1) + 120 - viewport.current
      if (target.current > left) scrollTo(left)
      else if (target.current < right) scrollTo(right)
    },
    [scrollTo],
  )

  /** Moves `data-active` (keyboard highlight) to `i`, written on the item: no render. */
  const mark = useCallback((i: number | null) => {
    if (marked.current === i) return
    if (marked.current !== null) itemEls.current[marked.current]?.removeAttribute('data-active')
    marked.current = i
    if (i !== null) itemEls.current[i]?.setAttribute('data-active', '1')
  }, [])

  const focusCover = useCallback(
    (i: number) => {
      const n = Math.max(0, Math.min(countRef.current - 1, i))
      active.current = n
      mark(n)
      reveal(n)
      slotEls.current[n]?.focus({ preventScroll: true })
    },
    [mark, reveal],
  )

  const createCollection = useCallback(async () => {
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
  }, [])

  const open = useCallback(
    (i: number) => {
      const node = treeRef.current[i]
      if (node) navigate({ name: 'collection', uuid: node.uuid })
      else void createCollection()
    },
    [navigate, createCollection],
  )

  const handlers = useMemo<ItemHandlers>(
    () => ({
      enter(i) {
        active.current = i
        // The pointer takes over from the keyboard highlight (one cover out at a time).
        if (marked.current !== i) mark(null)
      },
      leave(i) {
        if (active.current === i) active.current = null
      },
      focus(i, el) {
        active.current = i
        if (el.matches(':focus-visible')) mark(i)
      },
      blur(i) {
        if (marked.current === i) mark(null)
      },
      click: open,
      item(i, el) {
        itemEls.current[i] = el
      },
      slot(i, el) {
        slotEls.current[i] = el
      },
    }),
    [mark, open],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().overlay || isEditableTarget(e.target)) return
      if (e.metaKey || e.altKey || e.ctrlKey) return
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        const base = active.current ?? -1
        focusCover(e.key === 'ArrowRight' ? base + 1 : Math.max(0, base - 1))
      } else if (e.key === 'Enter' && active.current !== null) {
        e.preventDefault()
        open(active.current)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        navigate({ name: 'library' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusCover, open, navigate])

  // Entry, once on mount: decode the covers of the falling slices, then release the cascade.
  useEffect(() => {
    if (phase !== 'wait') return
    let cancelled = false
    const imgs = Array.from(
      rootRef.current?.querySelectorAll<HTMLImageElement>('.shelf-item[data-anim] img') ?? [],
    )
    const decoded = Promise.allSettled(imgs.map((img) => img.decode()))
    const cap = new Promise((r) => window.setTimeout(r, DECODE_CAP_MS))
    void Promise.race([decoded, cap]).then(() => {
      // One frame to paint the decoded covers before the first frame of the fall.
      requestAnimationFrame(() => {
        if (!cancelled) setPhase('enter')
      })
    })
    return () => {
      cancelled = true
    }
  }, [phase])

  useEffect(() => {
    if (phase !== 'enter') return
    const falling = Math.min(animated, countRef.current)
    const id = window.setTimeout(() => setPhase('rest'), reduced ? 200 : entranceMs(falling) + 60)
    return () => window.clearTimeout(id)
  }, [phase, reduced, animated])

  // Videos: once landed, while the window is shown and focused and no overlay covers the shelf.
  useEffect(() => {
    if (phase !== 'rest' || reduced) return
    const sync = () =>
      videos.setEnabled(
        document.visibilityState === 'visible' &&
          document.hasFocus() &&
          useUi.getState().overlay === null,
      )
    updateVisible()
    sync()
    const offUi = useUi.subscribe(sync)
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)
    return () => {
      offUi()
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener('blur', sync)
      videos.setEnabled(false)
    }
  }, [phase, reduced, videos, updateVisible])

  // Slices added or removed: the set in the window changes.
  useEffect(updateVisible, [count, updateVisible])

  return (
    <div
      ref={rootRef}
      data-testid="shelf"
      data-phase={phase}
      className="shelf-root shelf absolute inset-0 -top-24 z-0 select-none"
      onWheel={onWheel}
    >
      <Starfield ref={starsRef} />
      <div
        ref={unveilRef}
        className="shelf-unveil"
        aria-hidden="true"
        onAnimationEnd={() => {
          if (unveilRef.current) unveilRef.current.style.display = 'none'
        }}
      />
      <div ref={trackRef} className="shelf-track" role="list" aria-label={tr.nav.collections}>
        {tree.map((node, i) => (
          <ShelfItem
            key={node.uuid}
            index={i}
            node={node}
            card={covers[i]}
            animate={i < animated}
            videos={videos}
            handlers={handlers}
          />
        ))}
        <NewItem index={tree.length} animate={tree.length < animated} handlers={handlers} />
      </div>
    </div>
  )
}
