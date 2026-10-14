/**
 * Video player hygiene: no video may play (let alone with sound) outside the
 * detail view, nor while the window is hidden, and never two with sound at once.
 *  - `releaseVideo`: pause then releases the stream (`removeAttribute('src')` + `load()`).
 *  - `mountVideo`: ref callback (React 19) of a rendered `<video>`: attaches its `data-src` once
 *    the element is committed, releases it on unmount.
 *  - `allowOffscreen`: marks a detached video (frames copied into a canvas) as legitimate; muted.
 *  - `installVideoGuard`: central registry of EVERY `<video>` the renderer creates (in or out of
 *    the document) and the rules applied to them on each `play`, `volumechange` and
 *    `visibilitychange`.
 *
 * Why the stream is attached in the ref and not in JSX: React creates DOM nodes while rendering,
 * before committing. A concurrent render that React throws away (store change during the render,
 * suspension) leaves behind a `<video autoplay src>` that is never inserted nor cleaned up, and
 * Chromium plays a detached video, sound included: the detail view was heard twice and kept
 * playing after closing. A `<video>` without `src` costs nothing if its render is discarded.
 */

/** Root of the detail view; `data-closing` is set at the start of the closing animation. */
export const VIEWER_SELECTOR = '[data-testid="detail"]:not([data-closing])'

/** Immediate pause (without releasing the stream: the video can still be resumed). */
export function pauseVideo(v: HTMLVideoElement | null | undefined): void {
  if (!v) return
  try {
    v.pause()
  } catch {
    // element already destroyed
  }
}

/** Pauses, then releases the network/decoder stream. */
export function releaseVideo(v: HTMLVideoElement | null | undefined): void {
  if (!v) return
  pauseVideo(v)
  try {
    if (!v.hasAttribute('src') && !v.currentSrc) return
    v.removeAttribute('src')
    v.load()
  } catch {
    // element already destroyed
  }
}

/**
 * Releases the stream of a `<video>` removed from the document (unmount, change of `key`). Immediate
 * pause; release deferred by a microtick to ignore StrictMode's double call
 * (the element stays connected there).
 */
export function releaseDetached(el: HTMLVideoElement): void {
  pauseVideo(el)
  queueMicrotask(() => {
    if (!el.isConnected) releaseVideo(el)
  })
}

/** `ref` of a `<video>`: releases the stream on unmount (or on change of `key`). */
export function releaseOnUnmount(el: HTMLVideoElement | null): (() => void) | void {
  if (!el) return
  return () => releaseDetached(el)
}

/**
 * `ref` of a rendered `<video data-src=…>` (with `key={src}`): the stream is attached only once
 * the element is committed, and released on unmount. Never put `src` in the JSX of a `<video>`.
 */
export function mountVideo(el: HTMLVideoElement | null): (() => void) | void {
  if (!el) return
  attachSrc(el)
  return () => releaseDetached(el)
}

/** Attaches `data-src` as the stream (idempotent). */
export function attachSrc(el: HTMLVideoElement): void {
  const src = el.dataset.src
  if (src && el.getAttribute('src') !== src) el.src = src
}

/** Sound outside the Viewer (or while it is closing) is never allowed. */
export function mustStayQuiet(v: HTMLVideoElement): boolean {
  if (v.muted || v.volume === 0) return false
  return !v.isConnected || !v.closest(VIEWER_SELECTOR)
}

/** Detached videos allowed to play (their frames are drawn elsewhere); always silent. */
const offscreen = new WeakSet<HTMLVideoElement>()

/** Every `<video>` created by the renderer (weak: dropped ones are collected). */
const tracked = new Set<WeakRef<HTMLVideoElement>>()

/** Marks a detached video as a legitimate frame source: muted and at volume 0 before any play. */
export function allowOffscreen(v: HTMLVideoElement): void {
  offscreen.add(v)
  v.defaultMuted = true
  v.muted = true
  v.volume = 0
}

/** Live videos of the registry (measurements, guard). */
export function trackedVideos(): HTMLVideoElement[] {
  const out: HTMLVideoElement[] = []
  for (const ref of tracked) {
    const v = ref.deref()
    if (v) out.push(v)
    else tracked.delete(ref)
  }
  return out
}

/**
 * Rules, applied when a video starts or changes volume:
 *  - detached and not a registered frame source: orphan (discarded render, leaked element),
 *    stopped and released;
 *  - window hidden: paused;
 *  - frame source: forced silent;
 *  - sound outside the open Viewer: paused;
 *  - the Viewer's video with sound: every other audible video is paused (one sound at a time).
 */
export function enforce(v: HTMLVideoElement, doc: Document = document): void {
  if (v.paused) return
  if (!v.isConnected && !offscreen.has(v)) {
    releaseVideo(v)
    return
  }
  if (doc.visibilityState === 'hidden') {
    pauseVideo(v)
    return
  }
  if (offscreen.has(v)) {
    if (!v.muted || v.volume > 0) allowOffscreen(v)
    return
  }
  if (mustStayQuiet(v)) {
    pauseVideo(v)
    return
  }
  if (v.muted || v.volume === 0) return
  for (const o of trackedVideos()) {
    if (o !== v && !o.paused && !o.muted && o.volume > 0) pauseVideo(o)
  }
}

function track(v: HTMLVideoElement, doc: Document): void {
  tracked.add(new WeakRef(v))
  const check = () => enforce(v, doc)
  v.addEventListener('play', check)
  v.addEventListener('playing', check)
  v.addEventListener('volumechange', check)
}

let installed = false

/** Global safety net, installed once at renderer startup (before the first render). */
export function installVideoGuard(doc: Document = document): void {
  if (installed) return
  installed = true
  // Registry: every `<video>` created through this document (React, shelf canvases, …).
  const create = doc.createElement.bind(doc)
  doc.createElement = (...args: Parameters<Document['createElement']>) => {
    const el = create(...args)
    if (el instanceof HTMLVideoElement) track(el, doc)
    return el
  }
  for (const v of doc.querySelectorAll('video')) track(v, doc)
  // Connected videos created another way (parser): `play` does not bubble, capture phase.
  doc.addEventListener(
    'play',
    (e) => {
      const v = e.target
      if (v instanceof HTMLVideoElement) enforce(v, doc)
    },
    true,
  )
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') {
      for (const v of trackedVideos()) pauseVideo(v)
      doc.querySelectorAll('video').forEach((v) => pauseVideo(v))
    } else {
      // Muted previews (hover loops / Rediscover / Spaces) resume; never the Viewer. The shelf's
      // frame sources are resumed by the shelf itself.
      doc
        .querySelectorAll<HTMLVideoElement>('video[autoplay]')
        .forEach((v) => v.muted && v.isConnected && void v.play().catch(() => undefined))
    }
  })
}
