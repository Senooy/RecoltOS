/**
 * 3D shelf of collections: full-frame black background + `Starfield`, labels at y≈104 in steps
 * of 122 px from x≈150, covers 410×700 in `rotateY(-35deg)` (image sized for the face: the
 * 800 px thumbnail when it covers the face at 2×, otherwise `large`; text post in a white
 * `TweetCard cover`; muted looping `preview` video: ONE at a time, that of the hovered cover or,
 * failing that, the one closest to the centre; never the original). Only one: as soon as two
 * videos play on screen, Chromium aligns the display on their rate (30 Hz, the compositor's
 * "video call" heuristic), and the drop of the slices as well as their hover fall to one frame in
 * four on a 120 Hz screen.
 *
 * Performance contract (120 Hz):
 *  - No React render per frame or per hover: hover is pure CSS (`:hover` on the slot, sibling
 *    layers), scrolling writes the track `transform` (and the star parallax) from a rAF through
 *    refs, the keyboard state is a `data-active` written on the item. The items are memoized; the
 *    only per-item state is "does my video play", read from a tiny store (`player`), so changing
 *    the video re-renders two items.
 *  - Entry: the covers of the slices visible at entry are decoded (`img.decode()`, capped) BEFORE
 *    the cascade starts (`data-phase` wait → enter → rest): no image arriving, and no raster,
 *    during the fall. The slices outside the window do not fall, they are in place.
 *  - Videos: none during the entry; on hover, the video starts once the slide-out is over (and
 *    after the pointer stays), never two at once. The video is a separate layer above the face
 *    image, which stays painted: no re-raster when it starts or stops.
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
  useSyncExternalStore,
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
/** Videos played at the same time (see the header: beyond one, the display drops to 30 Hz). */
export const MAX_PLAYING = 1
/** Hover slide-out (`shelf.css`); the hovered video starts once it is over. */
export const HOVER_MS = 220
const VIDEO_DELAY_MS = HOVER_MS + 60
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

const isVideoCard = (c: ItemCard | undefined) => c?.kind === 'video' && c.previewUrl !== null

/** "Which cover plays its video": one value, each item subscribes to its own boolean. */
interface Player {
  get: () => number | null
  set: (i: number | null) => void
  subscribe: (cb: () => void) => () => void
}

function createPlayer(): Player {
  let value: number | null = null
  const subs = new Set<() => void>()
  return {
    get: () => value,
    set(i) {
      if (i === value) return
      value = i
      for (const cb of subs) cb()
    },
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
  }
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
  player,
  handlers,
}: {
  index: number
  node: CollectionNode
  card: ItemCard | undefined
  animate: boolean
  player: Player
  handlers: ItemHandlers
}) {
  const play = useSyncExternalStore(player.subscribe, () => player.get() === index)
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
      {play && card?.previewUrl ? (
        <video
          ref={releaseOnUnmount}
          data-testid="shelf-video"
          className="cover-layer cover-video"
          aria-hidden="true"
          src={mediaSrc(card.previewUrl)}
          muted
          loop
          autoPlay
          playsInline
          crossOrigin="anonymous"
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
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const player = useMemo(createPlayer, [])
  const videoTimer = useRef(0)

  const count = tree.length + 1 // + "New collection" cover
  // Slots visible at entry (fixed at mount: the cascade does not replay); those slices fall.
  const [animated] = useState(() => animatedCount(window.innerWidth))

  const treeRef = useRef(tree)
  treeRef.current = tree
  const countRef = useRef(count)
  countRef.current = count
  const covers = useMemo(() => tree.map((n) => n.covers[0]), [tree])
  const coversRef = useRef(covers)
  coversRef.current = covers

  /** Video to play now: the hovered/focused cover if it is a video, otherwise the centre one. */
  const chooseVideo = useCallback((): number | null => {
    if (reduced || phaseRef.current !== 'rest') return null
    const isVideo = coversRef.current.map(isVideoCard)
    const a = active.current
    if (a !== null && isVideo[a]) return a
    const [first] = playingIndices(isVideo, current.current, viewport.current)
    return first ?? null
  }, [reduced])

  /** Re-elects the video after `delay` (cancels a pending election: quick sweeps start nothing). */
  const scheduleVideo = useCallback(
    (delay: number) => {
      window.clearTimeout(videoTimer.current)
      videoTimer.current = window.setTimeout(() => player.set(chooseVideo()), delay)
    },
    [chooseVideo, player],
  )
  useEffect(() => () => window.clearTimeout(videoTimer.current), [])

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
        scheduleVideo(0)
        return
      }
      if (raf.current) return
      const step = () => {
        const d = target.current - current.current
        current.current = Math.abs(d) < 0.5 ? target.current : current.current + d * 0.16
        applyScroll(current.current)
        if (current.current === target.current) {
          raf.current = 0
          // At rest: the centre video may have changed.
          scheduleVideo(120)
        } else raf.current = requestAnimationFrame(step)
      }
      raf.current = requestAnimationFrame(step)
    },
    [reduced, applyScroll, scheduleVideo],
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
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [applyScroll])

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
      scheduleVideo(VIDEO_DELAY_MS)
    },
    [mark, reveal, scheduleVideo],
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
        scheduleVideo(VIDEO_DELAY_MS)
      },
      leave(i) {
        if (active.current === i) active.current = null
        scheduleVideo(VIDEO_DELAY_MS)
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
    [mark, open, scheduleVideo],
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

  // Landed: the centre video (or the hovered one) may start.
  useEffect(() => {
    if (phase === 'rest') player.set(chooseVideo())
  }, [phase, player, chooseVideo])

  // Covers changed (reload of the tree): the elected video may no longer be a video.
  useEffect(() => {
    if (phaseRef.current === 'rest') player.set(chooseVideo())
  }, [covers, player, chooseVideo])

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
            player={player}
            handlers={handlers}
          />
        ))}
        <NewItem index={tree.length} animate={tree.length < animated} handlers={handlers} />
      </div>
    </div>
  )
}
