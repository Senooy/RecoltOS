/**
 * Redécouvrir (DESIGN §3.8, AI §10, WP-32) : voile `--rd-scrim` + flou 40 au-dessus de l'app,
 * compteur « 1 / 408 », 3 cibles (Collection ↑, Corbeille ←, Garder →), pile de 3 cartes, geste
 * motion (rotation x/20, validation au-delà de 120 pt ou 600 pt/s, retour en `spring.swipe`),
 * sélecteur de collection ancré sur la cible du haut, raccourcis cachés ↓ (passer) et ⌘Z,
 * pilule d'aide, écran de fin, préchargement de 3 images.
 *
 * Rafales la référence (`su4jd8…l480id`) : pendant le glisser, la carte suit le pointeur et pivote, la
 * cible visée s'allume, et les cartes suivantes s'écartent en éventail du côté opposé.
 */
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  FolderPlus,
  Trash2,
  X,
} from 'lucide-react'
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type MotionValue,
  type PanInfo,
} from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ItemCard } from '../../../../shared/dto/items'
import type { NamedRef } from '../../../../shared/dto/items'
import { isReducedMotion, toast } from '../../components/ui'
import { fr } from '../../i18n/fr'
import { cn } from '../../lib/cn'
import { cardLargeSrc, mediaSrc } from '../../lib/media-url'
import { RpcError, rpc } from '../../lib/rpc'
import { askName } from '../../state/dialogs'
import { useUi } from '../../state/ui'
import { useUndo } from '../../state/undo'
import { CollectionPickerPopover } from '../collections/CollectionPicker'
import { TweetCard } from '../grid/cards/TweetCard'
import './rediscover.css'

export const SWIPE_DIST = 120
export const SWIPE_VELOCITY = 600
const SPRING = { type: 'spring', stiffness: 300, damping: 30 } as const
const PAGE = 50
const CARD_MAX_W = 460
const CARD_MAX_H = 440
/** Seuil d'allumage d'une cible pendant le glisser. */
const AIM_DIST = 48

export type Aim = 'keep' | 'trash' | 'collection' | null

/** Cible visée par un déplacement (dx, dy). */
export function aimOf(dx: number, dy: number): Aim {
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx > AIM_DIST) return 'keep'
    if (dx < -AIM_DIST) return 'trash'
    return null
  }
  return dy < -AIM_DIST ? 'collection' : null
}

/** Décision au relâcher (distance ou vitesse), sinon `null` (retour en ressort). */
export function decide(
  offset: { x: number; y: number },
  velocity: { x: number; y: number },
): Exclude<Aim, null> | null {
  const horiz = Math.abs(offset.x) >= Math.abs(offset.y)
  if (horiz) {
    if (offset.x > SWIPE_DIST || velocity.x > SWIPE_VELOCITY) return 'keep'
    if (offset.x < -SWIPE_DIST || velocity.x < -SWIPE_VELOCITY) return 'trash'
  } else if (offset.y < -SWIPE_DIST || velocity.y < -SWIPE_VELOCITY) return 'collection'
  return null
}

function motionOff(): boolean {
  return isReducedMotion() || document.documentElement.dataset.e2e === '1'
}

/** Image fixe de la carte (une vidéo n'a jamais son original dans un `<img>`). */
function stillSrc(c: ItemCard): string | undefined {
  return c.kind === 'video'
    ? mediaSrc(c.largeUrl ?? c.posterUrl ?? c.thumbUrl)
    : (cardLargeSrc(c) ?? mediaSrc(c.posterUrl))
}

function cardSize(c: ItemCard): { w: number; h: number } {
  if (c.kind === 'tweet') return { w: 400, h: 0 }
  const r = c.width && c.height ? c.width / c.height : 1
  let w = CARD_MAX_W
  let h = w / r
  if (h > CARD_MAX_H) {
    h = CARD_MAX_H
    w = h * r
  }
  return { w: Math.round(w), h: Math.round(h) }
}

function CardFace({ card, top }: { card: ItemCard; top: boolean }) {
  const { w, h } = cardSize(card)
  if (card.kind === 'tweet') {
    return <TweetCard card={card} variant="overlay" className="rd-tweet-only w-[400px]" />
  }
  // Aperçu vidéo en boucle (hors e2e : rendu déterministe des références visuelles).
  const video =
    card.kind === 'video' && top && document.documentElement.dataset.e2e !== '1'
      ? mediaSrc(card.previewUrl)
      : undefined
  const img = stillSrc(card)
  return (
    <div
      className="rd-card-media"
      style={{ width: w, height: h, background: card.dominant ?? '#1c1c1e' }}
    >
      {img ? <img src={img} alt="" draggable={false} className="rd-img" /> : null}
      {video ? <video src={video} autoPlay loop muted playsInline className="rd-img" /> : null}
      {card.post && (card.post.text || card.post.quoted) ? (
        <div className="rd-tweet-wrap">
          <TweetCard card={card} variant="overlay" className="rd-tweet" />
        </div>
      ) : null}
    </div>
  )
}

function Target({
  kind,
  label,
  icon,
  arrow,
  active,
  style,
  children,
}: {
  kind: Exclude<Aim, null>
  label: string
  icon: ReactNode
  arrow: ReactNode
  active: boolean
  style: React.CSSProperties
  children?: ReactNode
}) {
  return (
    <div className="rd-target-wrap" style={style} data-testid={`rd-target-${kind}`}>
      {children ?? (
        <div className={cn('rd-target', active && 'is-active', kind === 'trash' && 'is-danger')}>
          {icon}
        </div>
      )}
      <div className="rd-target-label">{label}</div>
      <span className="rd-kbd">{arrow}</span>
    </div>
  )
}

/** Carte de la pile à la profondeur `depth` (0 = dessus). */
function StackCard({
  card,
  depth,
  x,
  y,
  onDrag,
  onDragEnd,
}: {
  card: ItemCard
  depth: number
  x: MotionValue<number>
  y: MotionValue<number>
  onDrag: (info: PanInfo) => void
  onDragEnd: (info: PanInfo) => void
}) {
  const k = depth === 1 ? 0.3 : 0.17
  const fanSign = depth === 1 ? -1 : 1
  const rotate = useTransform(x, (v) => v / 20)
  const bx = useTransform(x, (v) => -v * k)
  const by = useTransform(y, (v) => -v * k)
  const brot = useTransform([x, y], ([vx, vy]: number[]) => {
    const dist = Math.hypot(vx ?? 0, vy ?? 0)
    const p = Math.min(1, dist / 160)
    const dir = Math.abs(vx ?? 0) >= Math.abs(vy ?? 0) ? Math.sign(vx ?? 0) : fanSign
    return -dir * p * (depth === 1 ? 9 : 5)
  })
  const base =
    depth === 0
      ? { rotate: 1.5, scale: 1, y: 0, opacity: 1 }
      : depth === 1
        ? { rotate: -4, scale: 0.96, y: 8, opacity: 0.9 }
        : { rotate: 3, scale: 0.92, y: 16, opacity: 0.7 }
  const top = depth === 0
  return (
    <motion.div
      className="rd-slot"
      style={{ zIndex: 10 - depth }}
      initial={false}
      animate={base}
      transition={SPRING}
    >
      <motion.div
        data-testid={top ? 'rd-card' : 'rd-card-behind'}
        data-uuid={card.uuid}
        className={cn('rd-card', top && 'is-top')}
        style={top ? { x, y, rotate } : { x: bx, y: by, rotate: brot }}
        drag={top}
        dragMomentum={false}
        dragElastic={1}
        onDrag={top ? (_e, info) => onDrag(info) : undefined}
        onDragEnd={top ? (_e, info) => onDragEnd(info) : undefined}
      >
        <CardFace card={card} top={top} />
      </motion.div>
    </motion.div>
  )
}

export default function Rediscover() {
  const overlay = useUi((s) => s.overlay)
  const collectionUuid = overlay?.type === 'rediscover' ? overlay.collectionUuid : undefined
  const [seed, setSeed] = useState(() =>
    document.documentElement.dataset.e2e === '1' ? 42 : Math.floor(Math.random() * 2 ** 31),
  )
  const [cards, setCards] = useState<ItemCard[]>([])
  const [total, setTotal] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [index, setIndex] = useState(0)
  const [session, setSession] = useState('rd')
  const [suggested, setSuggested] = useState<NamedRef[]>([])
  const [aim, setAim] = useState<Aim>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const busy = useRef(false)
  const loadingMore = useRef(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)

  const load = useCallback(
    async (offset: number) => {
      const r = await rpc('rediscover.deck', {
        seed,
        limit: PAGE,
        offset,
        ...(collectionUuid ? { collectionUuid } : {}),
      })
      setTotal(r.total)
      setSession(r.sessionId)
      setSuggested(r.suggestedCollections)
      setCards((prev) => (offset === 0 ? r.items : [...prev, ...r.items]))
      setLoaded(true)
    },
    [seed, collectionUuid],
  )

  useEffect(() => {
    setIndex(0)
    void load(0).catch((err: unknown) => {
      toast(err instanceof RpcError ? err.message : fr.errors.generic)
      setLoaded(true)
    })
  }, [load])

  // Pages suivantes et préchargement des 3 images à venir.
  useEffect(() => {
    if (cards.length < total && index > cards.length - 10 && !loadingMore.current) {
      loadingMore.current = true
      void load(cards.length).finally(() => {
        loadingMore.current = false
      })
    }
    for (const c of cards.slice(index + 1, index + 4)) {
      const src = stillSrc(c)
      if (src) new Image().src = src
    }
  }, [index, cards, total, load])

  // Apparition : voile flouté en fondu (~150 ms), comme la référence.
  useEffect(() => {
    rootRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: motionOff() ? 80 : 160,
      easing: 'ease-out',
    })
    rootRef.current?.focus({ preventScroll: true })
  }, [])

  const close = useCallback(() => {
    const el = rootRef.current
    const done = () => useUi.getState().closeOverlay()
    if (!el) return done()
    const a = el.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: motionOff() ? 60 : 140,
      easing: 'ease-in',
      fill: 'forwards',
    })
    a.onfinish = done
  }, [])

  const current = cards[index]

  const reset = useCallback(() => {
    x.set(0)
    y.set(0)
  }, [x, y])

  const springBack = useCallback(() => {
    setAim(null)
    if (motionOff()) return reset()
    void animate(x, 0, SPRING)
    void animate(y, 0, SPRING)
  }, [x, y, reset])

  /** Applique l'action (base + journal), fait partir la carte, puis passe à la suivante. */
  const commit = useCallback(
    async (
      action: 'keep' | 'trash' | 'collection' | 'skip',
      collection?: { uuid: string; name: string },
      velocity = { x: 0, y: 0 },
    ) => {
      const card = cards[index]
      if (!card || busy.current) return
      busy.current = true
      setAim(action === 'skip' ? null : action)
      try {
        await rpc('rediscover.act', {
          itemUuid: card.uuid,
          action,
          sessionId: session,
          ...(collection ? { collectionUuid: collection.uuid } : {}),
        })
      } catch (err) {
        busy.current = false
        toast(err instanceof RpcError ? err.message : fr.errors.generic)
        springBack()
        return
      }
      const restore = index
      useUndo.getState().push({
        label: 'rediscover',
        undo: async () => {
          const r = await rpc('rediscover.undo')
          if (!r) {
            toast(fr.rediscoverUi.nothingToUndo)
            return
          }
          toast(fr.rediscoverUi.undone)
          setIndex((i) => (i > restore ? restore : i))
        },
      })
      const W = window.innerWidth
      const H = window.innerHeight
      const fly = async () => {
        if (motionOff()) return
        const opts = { ...SPRING, stiffness: 220, damping: 26 }
        if (action === 'keep') await animate(x, W, { ...opts, velocity: Math.max(velocity.x, 800) })
        else if (action === 'trash')
          await animate(x, -W, { ...opts, velocity: Math.min(velocity.x, -800) })
        else if (action === 'collection')
          await animate(y, -H, { ...opts, velocity: Math.min(velocity.y, -800) })
        else await animate(y, H, { ...opts, velocity: 800 })
      }
      await fly()
      setAim(null)
      reset()
      setIndex((i) => i + 1)
      busy.current = false
    },
    [cards, index, session, x, y, reset, springBack],
  )

  const onDrag = useCallback((info: PanInfo) => setAim(aimOf(info.offset.x, info.offset.y)), [])
  const onDragEnd = useCallback(
    (info: PanInfo) => {
      const d = decide(info.offset, info.velocity)
      if (d === 'collection') {
        setAim('collection')
        void animate(y, -60, SPRING)
        void animate(x, 0, SPRING)
        setPickerOpen(true)
      } else if (d) void commit(d, undefined, info.velocity)
      else springBack()
    },
    [commit, springBack, x, y],
  )

  const pick = useCallback(
    (c: { uuid: string; name: string } | null) => {
      setPickerOpen(false)
      if (!c) return springBack()
      toast(fr.rediscoverUi.addedTo(c.name))
      void commit('collection', c)
    },
    [commit, springBack],
  )

  const createAndPick = useCallback(async () => {
    const name = await askName({
      title: fr.collection.new,
      initial: '',
      confirmLabel: fr.shell.create,
    })
    if (!name) return springBack()
    try {
      const node = await rpc('collections.create', { name })
      pick({ uuid: node.uuid, name: node.name })
    } catch (err) {
      toast(err instanceof RpcError ? err.message : fr.errors.generic)
      springBack()
    }
  }, [pick, springBack])

  // Clavier : ← → ↑ (cibles), ↓ passer (caché), Échap (⌘Z passe par le menu natif).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (pickerOpen) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setPickerOpen(false)
          springBack()
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
      if (!current) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        void commit('keep')
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        void commit('trash')
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        void commit('skip')
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAim('collection')
        if (!motionOff()) void animate(y, -60, SPRING)
        setPickerOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickerOpen, current, commit, close, springBack, y])

  const restart = () => {
    setCards([])
    setLoaded(false)
    setIndex(0)
    reset()
    setSeed(Math.floor(Math.random() * 2 ** 31))
  }

  const stack = useMemo(() => cards.slice(index, index + 3), [cards, index])
  const done = loaded && index >= total
  const W = typeof window === 'undefined' ? 1280 : window.innerWidth

  return (
    <div
      ref={rootRef}
      data-testid="rediscover"
      role="dialog"
      aria-modal="true"
      aria-label={fr.rediscoverUi.label}
      tabIndex={-1}
      className="rd-root"
    >
      <div className="rd-scrim" />
      <div className="rd-drag-strip app-drag" />
      {total > 0 && !done ? (
        <div className="rd-counter" data-testid="rd-counter">
          <span className="rd-counter-cur">{Math.min(index + 1, total)}</span>
          <span> / {total}</span>
        </div>
      ) : null}
      <button
        type="button"
        className="rd-close"
        aria-label={fr.rediscoverUi.close}
        data-testid="rd-close"
        onClick={close}
      >
        <X size={14} strokeWidth={2} />
      </button>

      {!done ? (
        <>
          <Target
            kind="collection"
            label={fr.rediscover.collection}
            icon={<FolderPlus size={20} strokeWidth={1.5} />}
            arrow={<ArrowUp size={10} strokeWidth={2.5} />}
            active={aim === 'collection' || pickerOpen}
            style={{ left: '50%', top: 105 }}
          >
            <CollectionPickerPopover
              open={pickerOpen}
              onOpenChange={(o) => {
                setPickerOpen(o)
                if (!o && busy.current === false && aim === 'collection') springBack()
              }}
              onPick={(n) => pick(n ? { uuid: n.uuid, name: n.name } : null)}
              suggested={suggested}
              onCreate={() => void createAndPick()}
              align="center"
            >
              <button
                type="button"
                aria-label={fr.rediscover.collection}
                className={cn('rd-target', (aim === 'collection' || pickerOpen) && 'is-active')}
                onClick={() => {
                  if (!current) return
                  setAim('collection')
                }}
              >
                <FolderPlus size={20} strokeWidth={1.5} />
              </button>
            </CollectionPickerPopover>
          </Target>
          <Target
            kind="trash"
            label={fr.rediscover.trash}
            icon={<Trash2 size={20} strokeWidth={1.5} />}
            arrow={<ArrowLeft size={10} strokeWidth={2.5} />}
            active={aim === 'trash'}
            style={{ left: 91, top: 385 }}
          >
            <button
              type="button"
              aria-label={fr.rediscover.trash}
              className={cn('rd-target is-danger', aim === 'trash' && 'is-active')}
              onClick={() => void commit('trash')}
            >
              <Trash2 size={20} strokeWidth={1.5} />
            </button>
          </Target>
          <Target
            kind="keep"
            label={fr.rediscover.keep}
            icon={<Check size={20} strokeWidth={1.5} />}
            arrow={<ArrowRight size={10} strokeWidth={2.5} />}
            active={aim === 'keep'}
            style={{ left: W - 96, top: 385 }}
          >
            <button
              type="button"
              aria-label={fr.rediscover.keep}
              className={cn('rd-target', aim === 'keep' && 'is-active')}
              onClick={() => void commit('keep')}
            >
              <Check size={20} strokeWidth={1.5} />
            </button>
          </Target>

          <div className="rd-stack" data-testid="rd-stack">
            {[...stack].reverse().map((c) => {
              const depth = stack.indexOf(c)
              return (
                <StackCard
                  key={c.uuid}
                  card={c}
                  depth={depth}
                  x={x}
                  y={y}
                  onDrag={onDrag}
                  onDragEnd={onDragEnd}
                />
              )
            })}
            {loaded && total === 0 ? <p className="rd-empty">{fr.rediscoverUi.empty}</p> : null}
          </div>

          <div className="rd-pill" data-testid="rd-hint">
            <span>{fr.rediscover.hintA}</span>
            <span className="rd-pill-kbd">
              <ArrowLeft size={10} strokeWidth={2.5} />
            </span>
            <span className="rd-pill-kbd">
              <ArrowUp size={10} strokeWidth={2.5} />
            </span>
            <span className="rd-pill-kbd">
              <ArrowRight size={10} strokeWidth={2.5} />
            </span>
            <span className="mx-0.5">·</span>
            <span className="rd-pill-kbd rd-pill-esc">esc</span>
            <span>{fr.rediscover.hintExit}</span>
            <span className="sr-only">
              <ArrowDown size={10} />
            </span>
          </div>
        </>
      ) : (
        <div className="rd-done" data-testid="rd-done">
          <div className="rd-done-title">{fr.rediscover.doneTitle}</div>
          <p className="rd-done-body">{fr.rediscover.doneBody}</p>
          <div className="mt-5 flex gap-2">
            <button type="button" className="rd-btn" onClick={restart}>
              {fr.rediscover.restart}
            </button>
            <button type="button" className="rd-btn" onClick={close}>
              {fr.rediscover.close}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
