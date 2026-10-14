/**
 * Shelf preview videos: every visible video cover plays at the same time, without the display
 * falling to the videos' cadence.
 *
 * As soon as two `<video>` elements are composited, Chromium aligns the display on their rate
 * (≈ 30 Hz, the compositor's "video call" heuristic): the cascade and the hover slide drop to one
 * frame in four on a 120 Hz screen. So the videos are NEVER in the document: each one is a
 * detached, muted `<video>` that keeps decoding (hardware H.264), and each decoded frame is copied
 * (`requestVideoFrameCallback` → `drawImage`, at the video's own rate) into a 2D canvas, the
 * slice's video layer. The compositor only sees canvases: it keeps its 120 Hz for the animations.
 *
 * The canvas is drawn with `object-fit: cover` cropping and the face's rounded corners (a clip in
 * the canvas itself: a CSS radius on a composited 3D layer would cost a mask per slice). Before
 * its first frame it is transparent, so the face image shows: nothing to hide or fade.
 *
 * Playing = enabled (shelf landed, window visible and focused, no overlay above, motion allowed)
 * AND slot in the window. The others are paused (their last frame stays). The `<video>` and its
 * stream are only created on the first play: nothing loads during the entry cascade.
 */
import { allowOffscreen, releaseVideo } from '../../../lib/video-guard'

/** Backing size of the video canvas (CSS 410×700 × 1.3: the 540p previews, without upscaling). */
export const VIDEO_CANVAS_W = 533
export const VIDEO_CANVAS_H = 910
const RADIUS = 6 * 1.3

interface Entry {
  canvas: HTMLCanvasElement
  url: string
  video: HTMLVideoElement | null
  ctx: CanvasRenderingContext2D | null
  frameCb: number
  wanted: boolean
}

export class ShelfVideos {
  private entries = new Map<number, Entry>()
  private enabled = false
  private visible: ReadonlySet<number> = new Set()

  /** Registers the video canvas of slice `i`; returns the cleanup (React 19 ref callback). */
  register(i: number, canvas: HTMLCanvasElement, url: string): () => void {
    const entry: Entry = { canvas, url, video: null, ctx: null, frameCb: 0, wanted: false }
    if (this.entries.has(i)) this.drop(i)
    this.entries.set(i, entry)
    this.syncOne(i, entry)
    return () => {
      if (this.entries.get(i) === entry) this.drop(i)
    }
  }

  /** Shelf landed and visible (window shown and focused, no overlay, motion allowed). */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return
    this.enabled = on
    this.sync()
  }

  /** Slices whose slot is in the window. */
  setVisible(visible: ReadonlySet<number>): void {
    this.visible = visible
    this.sync()
  }

  /** Number of videos currently playing (measurements). */
  get playing(): number {
    let n = 0
    for (const e of this.entries.values()) if (e.video && !e.video.paused) n++
    return n
  }

  destroy(): void {
    for (const i of [...this.entries.keys()]) this.drop(i)
  }

  private sync(): void {
    for (const [i, e] of this.entries) this.syncOne(i, e)
  }

  private syncOne(i: number, e: Entry): void {
    const want = this.enabled && this.visible.has(i)
    if (want === e.wanted) return
    e.wanted = want
    if (!want) {
      e.video?.pause()
      return
    }
    const v = e.video ?? this.createVideo(e)
    void v.play().catch(() => undefined)
  }

  private createVideo(e: Entry): HTMLVideoElement {
    const v = document.createElement('video')
    // Detached frame source, registered with the guard: muted and at volume 0 before any play.
    allowOffscreen(v)
    v.loop = true
    v.playsInline = true
    v.preload = 'auto'
    v.crossOrigin = 'anonymous'
    v.disablePictureInPicture = true
    v.src = e.url
    e.video = v
    const draw: VideoFrameRequestCallback = () => {
      if (e.video !== v) return
      this.drawFrame(e, v)
      e.frameCb = v.requestVideoFrameCallback(draw)
    }
    e.frameCb = v.requestVideoFrameCallback(draw)
    return v
  }

  private drawFrame(e: Entry, v: HTMLVideoElement): void {
    const vw = v.videoWidth
    const vh = v.videoHeight
    if (!vw || !vh) return
    if (!e.ctx) {
      const ctx = e.canvas.getContext('2d')
      if (!ctx) return
      e.canvas.width = VIDEO_CANVAS_W
      e.canvas.height = VIDEO_CANVAS_H
      ctx.beginPath()
      ctx.roundRect(0, 0, VIDEO_CANVAS_W, VIDEO_CANVAS_H, RADIUS)
      ctx.clip()
      ctx.imageSmoothingQuality = 'medium'
      e.ctx = ctx
    }
    // `object-fit: cover`, centred.
    const scale = Math.max(VIDEO_CANVAS_W / vw, VIDEO_CANVAS_H / vh)
    const sw = VIDEO_CANVAS_W / scale
    const sh = VIDEO_CANVAS_H / scale
    e.ctx.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, VIDEO_CANVAS_W, VIDEO_CANVAS_H)
  }

  private drop(i: number): void {
    const e = this.entries.get(i)
    if (!e) return
    this.entries.delete(i)
    if (e.video) {
      e.video.cancelVideoFrameCallback(e.frameCb)
      releaseVideo(e.video)
      e.video = null
    }
  }
}

/** Slices whose 122 px slot intersects the window `[scroll, scroll + viewport]`. */
export function visibleSlots(
  scroll: number,
  viewport: number,
  count: number,
  padLeft: number,
  step: number,
): Set<number> {
  const out = new Set<number>()
  for (let i = 0; i < count; i++) {
    const left = padLeft + step * i - scroll
    if (left + step > 0 && left < viewport) out.add(i)
  }
  return out
}
