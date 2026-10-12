/**
 * Video player hygiene: no video may play (let alone with sound) outside the
 * detail view, nor while the window is hidden.
 *  - `releaseVideo`: pause then releases the stream (`removeAttribute('src')` + `load()`).
 *  - `releaseOnUnmount`: ref callback (React 19) that releases the element on unmount.
 *  - `installVideoGuard`: global safety net (visibilitychange + guard "sound only in the Viewer").
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

/** Sound outside the Viewer (or while it is closing) is never allowed. */
export function mustStayQuiet(v: HTMLVideoElement): boolean {
  if (v.muted) return false
  return !v.isConnected || !v.closest(VIEWER_SELECTOR)
}

let installed = false

/** Global safety net, installed once at renderer startup. */
export function installVideoGuard(doc: Document = document): void {
  if (installed) return
  installed = true
  // `play` does not bubble: listen in the capture phase.
  doc.addEventListener(
    'play',
    (e) => {
      const v = e.target
      if (v instanceof HTMLVideoElement && mustStayQuiet(v)) pauseVideo(v)
    },
    true,
  )
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') {
      doc.querySelectorAll('video').forEach((v) => pauseVideo(v))
    } else {
      // Muted previews (hover loops / shelf / Rediscover) resume; never the Viewer.
      doc
        .querySelectorAll<HTMLVideoElement>('video[autoplay]')
        .forEach((v) => v.muted && v.isConnected && void v.play().catch(() => undefined))
    }
  })
}
