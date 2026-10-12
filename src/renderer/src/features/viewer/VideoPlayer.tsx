/**
 * `VideoPlayer` : barre de 44 pt SOUS le média (4 pt d'écart, retrait de 12 pt de
 * chaque côté), rayon 10, fond `--viewer-control` ; lecture/pause, « 0:00 / 0:35 » tabulaire, piste
 * de 3 px (progression blanche, pouce Ø 12, bulle de temps au survol), son (`prefs.videoMuted`).
 * La vidéo elle-même est rendue par la scène ; ce composant ne fait que la piloter.
 */
import { Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { fr } from '../../i18n/fr'
import { clock } from '../../lib/format'

export interface VideoPlayerProps {
  videoRef: RefObject<HTMLVideoElement | null>
  muted: boolean
  onToggleMute: () => void
  style?: React.CSSProperties
  className?: string
}

export function VideoPlayer({ videoRef, muted, onToggleMute, style, className }: VideoPlayerProps) {
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [paused, setPaused] = useState(true)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const sync = () => {
      if (!dragging.current) setTime(v.currentTime)
      setDuration(Number.isFinite(v.duration) ? v.duration : 0)
      setPaused(v.paused)
    }
    sync()
    const evs = ['timeupdate', 'durationchange', 'loadedmetadata', 'play', 'pause', 'seeked']
    evs.forEach((e) => v.addEventListener(e, sync))
    return () => evs.forEach((e) => v.removeEventListener(e, sync))
  }, [videoRef])

  const frac = duration > 0 ? Math.min(1, time / duration) : 0

  const timeAt = (clientX: number): number => {
    const el = trackRef.current
    if (!el || duration <= 0) return 0
    const r = el.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration
  }
  const seek = (t: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = t
    setTime(t)
  }
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    seek(timeAt(e.clientX))
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (r) setHoverX(Math.min(r.width, Math.max(0, e.clientX - r.left)))
    if (dragging.current) seek(timeAt(e.clientX))
  }
  const onUp = () => {
    dragging.current = false
  }
  const toggle = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play().catch(() => undefined)
    else v.pause()
  }
  const hoverTime =
    hoverX !== null && trackRef.current
      ? (hoverX / trackRef.current.getBoundingClientRect().width) * duration
      : 0

  return (
    <div
      data-testid="video-player"
      className={`viewer-player flex items-center ${className ?? ''}`}
      style={style}
    >
      <button
        type="button"
        className="viewer-player-btn"
        aria-label={paused ? fr.viewer.play : fr.viewer.pause}
        onClick={toggle}
      >
        {paused ? (
          <Play size={16} strokeWidth={2} fill="currentColor" />
        ) : (
          <Pause size={16} strokeWidth={2} fill="currentColor" />
        )}
      </button>
      <span className="viewer-player-time" data-testid="video-time">
        {clock(time)} / {clock(duration)}
      </span>
      <div
        ref={trackRef}
        className="viewer-player-track"
        role="slider"
        tabIndex={0}
        aria-label={fr.viewerUi.seek}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={clock(time)}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => setHoverX(null)}
      >
        <div className="viewer-player-rail" />
        <div className="viewer-player-fill" style={{ width: `${frac * 100}%` }} />
        <div className="viewer-player-thumb" style={{ left: `${frac * 100}%` }} />
        {hoverX !== null && duration > 0 ? (
          <div className="viewer-player-bubble" style={{ left: hoverX }}>
            {clock(hoverTime)}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="viewer-player-btn"
        aria-label={muted ? fr.viewer.unmute : fr.viewer.mute}
        onClick={onToggleMute}
      >
        {muted ? (
          <VolumeX size={16} strokeWidth={1.75} />
        ) : (
          <Volume2 size={16} strokeWidth={1.75} />
        )}
      </button>
    </div>
  )
}
