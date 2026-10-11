/**
 * Vue détail (DESIGN §3.7, ERRATA §C, WP-30) : calque plein écran sur fond en dégradés, barre de
 * 45 pt (retour, « 3 / 408 », zoom 25–300 %, Télécharger, Supprimer, Fermer), scène (média
 * `contain`, pincement / ⌘-molette, déplacement au-delà de 100 %, flèches au survol des bords),
 * lecteur vidéo sous le média, carrousel (⌥←/⌥→, points « 2 / 6 »), post sans média en
 * `TweetCard detail` de 560 pt, panneau Détails (⌘I).
 *
 * Transitions (mesurées sur la référence, rafales `0qtb20…6i4y14` et `g9x9ua…cx19x3`) : FLIP manuel WAAPI
 * depuis la carte de la grille (340 ms `--ease-sheet`) pendant que le voile flouté et le chrome
 * apparaissent en fondu ; à la fermeture, la grille fait défiler la carte courante en vue, le média
 * y revient, le voile se dissipe et les cartes réapparaissent en cascade. Carte non montée : fondu.
 * Mouvement réduit : fondus seuls (≤ 80 ms).
 */
import { useGesture } from '@use-gesture/react'
import { ChevronLeft, ChevronRight, Download, Trash2, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import type { ItemCard, ItemDetail } from '../../../../shared/dto/items'
import { FormatBadge, Slider, isReducedMotion, toast } from '../../components/ui'
import { fr } from '../../i18n/fr'
import { emit, on } from '../../lib/bus'
import { cn } from '../../lib/cn'
import { SHEET_EASING } from '../../lib/flip'
import { pct } from '../../lib/format'
import { mediaSrc } from '../../lib/media-url'
import { RpcError, rpc, subscribe } from '../../lib/rpc'
import { isEditableTarget } from '../../lib/shortcuts'
import { usePrefs } from '../../state/prefs'
import { useUi } from '../../state/ui'
import { trashItems } from '../grid/actions'
import { TweetCard } from '../grid/cards/TweetCard'
import { DetailsPanel, formatOf } from './DetailsPanel'
import {
  PANEL_BOTTOM,
  PANEL_RIGHT,
  PANEL_TOP,
  PANEL_W,
  PLAYER_GAP,
  PLAYER_H,
  PLAYER_INSET,
  TOPBAR_H,
  clampPan,
  clampZoom,
  fitMedia,
  stageRect,
  zoomRect,
  zoomStep,
  type Rect,
} from './layout'
import { sourceCard } from './open'
import { VideoPlayer } from './VideoPlayer'
import './viewer.css'

export const OPEN_MS = 340
export const CLOSE_MS = 280
export const FADE_MS = 200
const PANEL_KEY = 'recolt.viewer.panel.v1'
const DOTS_H = 28

/** Mouvement réduit, ou e2e (animations coupées, QA §2.2) : fondus courts, aucun FLIP. */
export function motionOff(): boolean {
  return isReducedMotion() || document.documentElement.dataset.e2e === '1'
}

function readPanelOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(PANEL_KEY) !== '0'
  } catch {
    return true
  }
}

function writePanelOpen(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(PANEL_KEY, open ? '1' : '0')
  } catch {
    // sans conséquence
  }
}

/** Élément média de la carte de la grille (pour le FLIP), s'il est monté et visible. */
function gridMediaEl(uuid: string): HTMLElement | null {
  const card = document.querySelector<HTMLElement>(
    `[data-testid="grid"] [data-uuid="${CSS.escape(uuid)}"]`,
  )
  if (!card) return null
  const r = card.getBoundingClientRect()
  if (r.bottom <= 0 || r.top >= window.innerHeight || r.width === 0) return null
  const page = card.dataset.cardKind === 'page' ? card.querySelector<HTMLElement>('img') : null
  return page ?? card
}

function px(r: Rect): Keyframe {
  return { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }
}

function useWindowSize(): { w: number; h: number } {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

type MediaKind = 'image' | 'video' | 'tweet' | 'page'

interface StageMedia {
  kind: MediaKind
  src: string | undefined
  placeholder: string | undefined
  poster: string | undefined
  width: number | null
  height: number | null
}

function stageMedia(card: ItemCard, detail: ItemDetail | null, slide: number): StageMedia {
  if (card.kind === 'tweet')
    return {
      kind: 'tweet',
      src: undefined,
      placeholder: undefined,
      poster: undefined,
      width: null,
      height: null,
    }
  const slides = detail?.slides ?? []
  const s = slides.length > 1 ? slides[Math.min(slide, slides.length - 1)] : undefined
  if (s && slide > 0) {
    const video = s.type === 'video'
    return {
      kind: video ? 'video' : 'image',
      src: mediaSrc(video ? s.originalUrl : (s.originalUrl ?? s.largeUrl)),
      placeholder: mediaSrc(s.largeUrl ?? s.thumbUrl),
      poster: mediaSrc(s.largeUrl ?? s.thumbUrl),
      width: s.width,
      height: s.height,
    }
  }
  const placeholder = mediaSrc(card.largeUrl ?? card.thumbUrl ?? card.posterUrl)
  if (card.kind === 'video')
    return {
      kind: 'video',
      src: mediaSrc(card.originalUrl ?? card.previewUrl),
      placeholder: mediaSrc(card.posterUrl ?? card.largeUrl ?? card.thumbUrl),
      poster: mediaSrc(card.posterUrl ?? card.largeUrl ?? card.thumbUrl),
      width: card.width,
      height: card.height,
    }
  return {
    kind: card.kind === 'url' ? 'page' : 'image',
    src: mediaSrc(card.originalUrl ?? card.largeUrl),
    placeholder,
    poster: undefined,
    width: card.width,
    height: card.height,
  }
}

/** Image : la grande vignette s'affiche tout de suite, l'original la remplace une fois décodé. */
function StageImage({ media }: { media: StageMedia }) {
  const [loaded, setLoaded] = useState<string | null>(null)
  return (
    <>
      {media.placeholder ? (
        <img src={media.placeholder} alt="" draggable={false} className="viewer-img" />
      ) : null}
      {media.src && media.src !== media.placeholder ? (
        <img
          src={media.src}
          alt=""
          draggable={false}
          decoding="async"
          className="viewer-img"
          style={{ opacity: loaded === media.src ? 1 : 0 }}
          onLoad={() => setLoaded(media.src ?? null)}
        />
      ) : null}
    </>
  )
}

export default function Viewer() {
  const overlay = useUi((s) => s.overlay)
  const start = overlay?.type === 'viewer' ? overlay : null
  const [list, setList] = useState<string[]>(() =>
    start ? (start.ids && start.ids.length > 0 ? start.ids : [start.uuid]) : [],
  )
  const [index, setIndex] = useState(() => Math.max(0, start ? list.indexOf(start.uuid) : 0))
  const uuid = list[index] ?? start?.uuid ?? ''
  const [detail, setDetail] = useState<ItemDetail | null>(null)
  const [slide, setSlide] = useState(0)
  const [panelOpen, setPanelOpen] = useState(readPanelOpen)
  const [layoutAnim, setLayoutAnim] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [ready, setReady] = useState(false)
  const [hoverStage, setHoverStage] = useState(false)
  const muted = usePrefs((s) => s.prefs.videoMuted)
  const win = useWindowSize()

  const rootRef = useRef<HTMLDivElement | null>(null)
  const backdropRef = useRef<HTMLDivElement | null>(null)
  const chromeRef = useRef<HTMLDivElement | null>(null)
  const mediaRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const closing = useRef(false)

  const card: ItemCard | null = detail && detail.uuid === uuid ? detail : (sourceCard(uuid) ?? null)
  const currentDetail = detail && detail.uuid === uuid ? detail : null

  // Détail complet (et rafraîchi sur `items.changed`) ; vue marquée.
  useEffect(() => {
    if (!uuid) return
    let alive = true
    const load = () =>
      rpc('items.get', { uuid })
        .then((d) => {
          if (alive) setDetail(d)
        })
        .catch((err: unknown) => {
          if (!alive) return
          if (err instanceof RpcError && err.code === 'not_found') toast(fr.viewerUi.notFound)
        })
    void load()
    void rpc('items.markViewed', { uuid }).catch(() => undefined)
    const off = subscribe('items.changed', ({ uuids }) => {
      if (uuids.includes(uuid)) void load()
    })
    const offCol = subscribe('collections.changed', () => void load())
    return () => {
      alive = false
      off()
      offCol()
    }
  }, [uuid])

  useEffect(() => {
    setSlide(0)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [uuid])

  const slides = currentDetail?.slides ?? []
  const slideCount = card && card.kind !== 'tweet' ? Math.max(slides.length, card.mediaCount) : 0
  const carousel = slideCount > 1
  const media = card ? stageMedia(card, currentDetail, slide) : null
  const stage = stageRect(win.w, win.h, panelOpen)
  const reserve = media?.kind === 'video' ? PLAYER_H + PLAYER_GAP : carousel ? DOTS_H : 0
  const fit = media
    ? fitMedia(
        stage,
        media.width ?? card?.width ?? null,
        media.height ?? card?.height ?? null,
        reserve,
      )
    : stage
  const box = zoomRect(fit, zoom, pan)

  // Ouverture : FLIP depuis la carte (ou fondu), voile et chrome en fondu.
  useLayoutEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
    const reduced = motionOff()
    const fade = reduced ? 80 : FADE_MS
    backdropRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: fade,
      easing: 'ease-out',
    })
    chromeRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: reduced ? 80 : 220,
      delay: reduced ? 0 : 40,
      easing: 'ease-out',
      fill: 'backwards',
    })
    const el = mediaRef.current
    const from = start && !reduced ? gridMediaEl(start.uuid) : null
    let anim: Animation | null = null
    if (el && from) {
      const r = from.getBoundingClientRect()
      if (card?.kind === 'tweet') {
        const to = el.getBoundingClientRect()
        const s = r.width / Math.max(1, to.width)
        anim = el.animate(
          [
            {
              transformOrigin: 'top left',
              transform: `translate(${r.left - to.left}px, ${r.top - to.top}px) scale(${s})`,
            },
            { transformOrigin: 'top left', transform: 'none' },
          ],
          { duration: OPEN_MS, easing: SHEET_EASING },
        )
      } else {
        anim = el.animate(
          [
            { ...px({ x: r.left, y: r.top, w: r.width, h: r.height }), borderRadius: '8px' },
            { ...px(box), borderRadius: '0px' },
          ],
          { duration: OPEN_MS, easing: SHEET_EASING },
        )
      }
    } else if (el) {
      anim = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fade, easing: 'ease-out' })
    }
    const done = () => setReady(true)
    if (anim) anim.onfinish = done
    else done()
    return () => anim?.cancel()
    // Une seule fois, au montage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finish = useCallback((target: HTMLElement | null) => {
    useUi.getState().closeOverlay()
    const card = target?.closest<HTMLElement>('[data-uuid]') ?? target
    card?.focus({ preventScroll: true })
  }, [])

  const close = useCallback(() => {
    if (closing.current) return
    closing.current = true
    videoRef.current?.pause()
    const reduced = motionOff()
    emit('grid.scrollTo', { uuid })
    let tries = 0
    const run = () => {
      const target = gridMediaEl(uuid)
      if (!target && tries++ < 4) {
        requestAnimationFrame(run)
        return
      }
      const el = mediaRef.current
      emit('grid.cascade', { except: target ? uuid : null })
      chromeRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: reduced ? 80 : 120,
        easing: 'ease-in',
        fill: 'forwards',
      })
      backdropRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: reduced ? 80 : 240,
        easing: 'ease-in-out',
        fill: 'forwards',
      })
      let anim: Animation | null = null
      if (el && target && !reduced) {
        const r = target.getBoundingClientRect()
        if (card?.kind === 'tweet') {
          const to = el.getBoundingClientRect()
          const s = r.width / Math.max(1, to.width)
          anim = el.animate(
            [
              { transformOrigin: 'top left', transform: 'none' },
              {
                transformOrigin: 'top left',
                transform: `translate(${r.left - to.left}px, ${r.top - to.top}px) scale(${s})`,
              },
            ],
            { duration: CLOSE_MS, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' },
          )
        } else {
          anim = el.animate(
            [
              { ...px(box), borderRadius: '0px' },
              { ...px({ x: r.left, y: r.top, w: r.width, h: r.height }), borderRadius: '8px' },
            ],
            { duration: CLOSE_MS, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' },
          )
        }
      } else if (el) {
        anim = el.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: reduced ? 80 : 180,
          fill: 'forwards',
        })
      }
      if (anim) anim.onfinish = () => finish(target)
      else finish(target)
    }
    requestAnimationFrame(run)
  }, [uuid, card?.kind, box, finish])

  const go = useCallback(
    (dir: 1 | -1) => {
      setIndex((i) => Math.min(list.length - 1, Math.max(0, i + dir)))
    },
    [list.length],
  )

  const goSlide = useCallback(
    (dir: 1 | -1) => {
      if (!carousel) return
      setSlide((s) => Math.min(slideCount - 1, Math.max(0, s + dir)))
      setZoom(1)
      setPan({ x: 0, y: 0 })
    },
    [carousel, slideCount],
  )

  const togglePanel = useCallback(() => {
    setLayoutAnim(true)
    setPanelOpen((o) => {
      writePanelOpen(!o)
      return !o
    })
    setTimeout(() => setLayoutAnim(false), 260)
  }, [])

  const setZoomTo = useCallback(
    (z: number) => {
      const next = clampZoom(z)
      setZoom(next)
      setPan((p) => clampPan(fit, next, p))
    },
    [fit],
  )

  const remove = useCallback(async () => {
    if (!uuid) return
    await trashItems([uuid])
    const next = list.filter((u) => u !== uuid)
    if (next.length === 0) {
      closing.current = true
      useUi.getState().closeOverlay()
      return
    }
    setList(next)
    setIndex((i) => Math.min(i, next.length - 1))
  }, [uuid, list])

  const download = useCallback(() => {
    if (!uuid) return
    void rpc('system.saveAs', { itemUuid: uuid })
      .then((r) => {
        if (r) toast(fr.viewerUi.downloaded)
      })
      .catch((err: unknown) => toast(err instanceof RpcError ? err.message : fr.errors.generic))
  }, [uuid])

  // Commandes du menu natif (⌘I, ⌘+, ⌘−, ⌘0, Aperçu rapide).
  useEffect(
    () =>
      on('overlay.command', ({ cmd }) => {
        if (cmd === 'toggleDetails') togglePanel()
        else if (cmd === 'zoomIn') setZoomTo(zoomStep(zoom, 1))
        else if (cmd === 'zoomOut') setZoomTo(zoomStep(zoom, -1))
        else if (cmd === 'zoomReset') {
          setZoom(1)
          setPan({ x: 0, y: 0 })
        } else if (cmd === 'quickLook' && uuid)
          void rpc('system.quickLook', { itemUuid: uuid }).catch(() => undefined)
      }),
    [togglePanel, setZoomTo, zoom, uuid],
  )

  // Clavier : Échap, ←/→ (éléments), ⌥←/⌥→ (slides), Maj+←/→ (±5 s), Espace, ⌘⌫.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const editing = isEditableTarget(e.target)
      if (e.key === 'Escape') {
        if (editing) return
        if (document.querySelector('[data-radix-popper-content-wrapper]')) return
        e.preventDefault()
        close()
        return
      }
      if (editing) return
      const v = videoRef.current
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const dir = e.key === 'ArrowRight' ? 1 : -1
        e.preventDefault()
        if (e.shiftKey && v)
          v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + dir * 5))
        else if (e.altKey) goSlide(dir)
        else if (!e.metaKey) go(dir)
      } else if (e.key === ' ' && v) {
        e.preventDefault()
        if (v.paused) void v.play().catch(() => undefined)
        else v.pause()
      } else if (e.key === 'Backspace' && e.metaKey) {
        e.preventDefault()
        void remove()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, go, goSlide, remove])

  // Pincement / ⌘-molette = zoom ; glisser = déplacement au-delà de 100 %.
  useGesture(
    {
      onWheel: ({ event, delta: [, dy] }) => {
        if (!event.metaKey) return
        event.preventDefault()
        setZoomTo(zoom * Math.exp(-dy * 0.002))
      },
      onPinch: ({ offset: [s], event }) => {
        event.preventDefault()
        setZoomTo(s)
      },
      onDrag: ({ delta: [dx, dy], pinching, tap }) => {
        if (pinching || tap || zoom <= 1) return
        setPan((p) => clampPan(fit, zoom, { x: p.x + dx, y: p.y + dy }))
      },
    },
    {
      target: stageRef,
      eventOptions: { passive: false },
      pinch: { scaleBounds: { min: 0.25, max: 3 }, from: () => [zoom, 0] },
      drag: { filterTaps: true },
    },
  )

  const counter = list.length > 0 ? fr.viewerUi.counter(index + 1, list.length) : ''
  const tweetFull = currentDetail?.post ?? null

  const mediaStyle: CSSProperties = useMemo(
    () => (media?.kind === 'tweet' ? {} : { left: box.x, top: box.y, width: box.w, height: box.h }),
    [media?.kind, box.x, box.y, box.w, box.h],
  )

  if (!start || !card || !media) return null

  const playerStyle: CSSProperties = {
    left: fit.x + PLAYER_INSET,
    top: fit.y + fit.h + PLAYER_GAP,
    width: Math.max(120, fit.w - 2 * PLAYER_INSET),
    height: PLAYER_H,
  }

  return (
    <div
      ref={rootRef}
      data-testid="detail"
      data-uuid={uuid}
      role="dialog"
      aria-modal="true"
      aria-label={fr.viewerUi.label}
      tabIndex={-1}
      className={cn('viewer-root', layoutAnim && 'viewer-layout-anim')}
    >
      <div ref={backdropRef} className="viewer-backdrop" />
      <div
        ref={stageRef}
        data-testid="viewer-stage"
        className="viewer-stage"
        onMouseEnter={() => setHoverStage(true)}
        onMouseLeave={() => setHoverStage(false)}
        onDoubleClick={() => {
          setZoom(1)
          setPan({ x: 0, y: 0 })
        }}
      >
        {media.kind === 'tweet' ? (
          <div
            className="viewer-tweet-wrap"
            style={{ left: stage.x, top: stage.y, width: stage.w, height: stage.h }}
          >
            <div
              ref={mediaRef}
              data-testid="viewer-media"
              data-kind="tweet"
              className="viewer-tweet"
            >
              <TweetCard card={card} variant="detail" full={tweetFull} />
            </div>
          </div>
        ) : (
          <div
            ref={mediaRef}
            data-testid="viewer-media"
            data-kind={media.kind}
            className={cn('viewer-media', zoom > 1 && 'is-zoomed')}
            style={mediaStyle}
          >
            {media.kind === 'video' ? (
              <video
                key={media.src}
                ref={videoRef}
                data-testid="viewer-video"
                src={media.src}
                poster={media.poster}
                autoPlay
                loop
                playsInline
                muted={muted}
                preload="auto"
                className="viewer-img"
              />
            ) : (
              <StageImage key={media.src ?? media.placeholder} media={media} />
            )}
            {media.kind === 'page' ? (
              <FormatBadge format="PAGE" className="absolute right-3 top-3" />
            ) : null}
            {carousel && hoverStage ? (
              <>
                {slide > 0 ? (
                  <button
                    type="button"
                    aria-label={fr.viewerUi.prevSlide}
                    className="viewer-slide-arrow left-3"
                    onClick={() => goSlide(-1)}
                  >
                    <ChevronLeft size={16} strokeWidth={2} />
                  </button>
                ) : null}
                {slide < slideCount - 1 ? (
                  <button
                    type="button"
                    aria-label={fr.viewerUi.nextSlide}
                    className="viewer-slide-arrow right-3"
                    onClick={() => goSlide(1)}
                  >
                    <ChevronRight size={16} strokeWidth={2} />
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        )}
      </div>

      <div ref={chromeRef} className="viewer-chrome">
        {media.kind === 'video' && ready ? (
          <VideoPlayer
            key={media.src}
            videoRef={videoRef}
            muted={muted}
            onToggleMute={() =>
              void usePrefs
                .getState()
                .update({ videoMuted: !muted })
                .catch(() => undefined)
            }
            className="viewer-fade-in absolute"
            style={playerStyle}
          />
        ) : null}
        {carousel ? (
          <div
            data-testid="slide-indicator"
            className="viewer-dots"
            role="status"
            aria-label={fr.viewerUi.slide(slide + 1, slideCount)}
            style={{ left: fit.x, width: fit.w, top: fit.y + fit.h + 10 }}
          >
            {Array.from({ length: slideCount }, (_, i) => (
              <span key={i} className={cn('viewer-dot', i === slide && 'is-active')} />
            ))}
            <span className="viewer-dots-text">{fr.viewerUi.counter(slide + 1, slideCount)}</span>
          </div>
        ) : null}
        {hoverStage && list.length > 1 ? (
          <>
            {index > 0 ? (
              <button
                type="button"
                aria-label={fr.viewer.previous}
                className="viewer-nav"
                style={{ left: stage.x + 16, top: stage.y + stage.h / 2 - 20 }}
                onMouseEnter={() => setHoverStage(true)}
                onClick={() => go(-1)}
              >
                <ChevronLeft size={18} strokeWidth={2} />
              </button>
            ) : null}
            {index < list.length - 1 ? (
              <button
                type="button"
                aria-label={fr.viewer.next}
                className="viewer-nav"
                style={{ left: stage.x + stage.w - 56, top: stage.y + stage.h / 2 - 20 }}
                onMouseEnter={() => setHoverStage(true)}
                onClick={() => go(1)}
              >
                <ChevronRight size={18} strokeWidth={2} />
              </button>
            ) : null}
          </>
        ) : null}

        <div className="viewer-topbar app-drag" style={{ height: TOPBAR_H }}>
          <button
            type="button"
            data-testid="viewer-back"
            aria-label={fr.viewer.back}
            className="viewer-back"
            onClick={close}
          >
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
          <span data-testid="viewer-counter" className="viewer-counter">
            {counter}
          </span>
          <div className="viewer-actions">
            {media.kind !== 'tweet' ? (
              <>
                <span className="viewer-zoom-text" data-testid="viewer-zoom">
                  {pct(zoom)}
                </span>
                <Slider
                  variant="zoom"
                  label={fr.viewerUi.zoom}
                  min={25}
                  max={300}
                  step={1}
                  value={Math.round(zoom * 100)}
                  valueText={pct(zoom)}
                  onValueChange={(v) => setZoomTo(v / 100)}
                  className="ml-[11px]"
                />
                <span className="viewer-sep ml-[15px]" />
              </>
            ) : null}
            <button
              type="button"
              aria-label={fr.viewer.download}
              data-testid="viewer-download"
              className="viewer-icon-btn ml-[13px]"
              onClick={download}
            >
              <Download size={18} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              aria-label={fr.viewer.delete}
              data-testid="viewer-delete"
              className="viewer-icon-btn ml-[10px]"
              onClick={() => void remove()}
            >
              <Trash2 size={18} strokeWidth={1.75} />
            </button>
            <span className="viewer-sep ml-[14px]" />
            <button
              type="button"
              aria-label={fr.viewer.close}
              data-testid="viewer-close"
              className="viewer-icon-btn ml-[12px]"
              onClick={close}
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {panelOpen ? (
          <DetailsPanel
            card={card}
            detail={currentDetail}
            style={{ right: PANEL_RIGHT, top: PANEL_TOP, bottom: PANEL_BOTTOM, width: PANEL_W }}
          />
        ) : null}
      </div>
      <span className="sr-only" aria-live="polite">
        {counter} {formatOf(card)}
      </span>
    </div>
  )
}
