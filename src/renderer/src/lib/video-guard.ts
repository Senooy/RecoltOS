/**
 * Hygiène des lecteurs vidéo : aucune vidéo ne doit jouer (encore moins avec le son) hors de la
 * vue détail, ni quand la fenêtre est masquée.
 *  - `releaseVideo` : pause puis libère le flux (`removeAttribute('src')` + `load()`).
 *  - `releaseOnUnmount` : callback de ref (React 19) qui libère l'élément à son démontage.
 *  - `installVideoGuard` : filet global (visibilitychange + garde « son seulement dans le Viewer »).
 */

/** Racine de la vue détail ; `data-closing` est posé dès le début de l'animation de fermeture. */
export const VIEWER_SELECTOR = '[data-testid="detail"]:not([data-closing])'

/** Pause immédiate (sans libérer le flux : la vidéo peut encore être reprise). */
export function pauseVideo(v: HTMLVideoElement | null | undefined): void {
  if (!v) return
  try {
    v.pause()
  } catch {
    // élément déjà détruit
  }
}

/** Pause, puis libère le flux réseau/décodeur. */
export function releaseVideo(v: HTMLVideoElement | null | undefined): void {
  if (!v) return
  pauseVideo(v)
  try {
    v.removeAttribute('src')
    v.load()
  } catch {
    // élément déjà détruit
  }
}

/**
 * Libère le flux d'un `<video>` retiré du document (démontage, changement de `key`). Pause
 * immédiate ; libération différée d'un micro-tick pour ignorer le double appel de StrictMode
 * (l'élément y reste connecté).
 */
export function releaseDetached(el: HTMLVideoElement): void {
  pauseVideo(el)
  queueMicrotask(() => {
    if (!el.isConnected) releaseVideo(el)
  })
}

/** `ref` d'un `<video>` : libère le flux au démontage (ou au changement de `key`). */
export function releaseOnUnmount(el: HTMLVideoElement | null): (() => void) | void {
  if (!el) return
  return () => releaseDetached(el)
}

/** Un son hors du Viewer (ou pendant sa fermeture) n'est jamais autorisé. */
export function mustStayQuiet(v: HTMLVideoElement): boolean {
  if (v.muted) return false
  return !v.isConnected || !v.closest(VIEWER_SELECTOR)
}

let installed = false

/** Filet de sécurité global, installé une fois au démarrage du renderer. */
export function installVideoGuard(doc: Document = document): void {
  if (installed) return
  installed = true
  // `play` ne remonte pas : écoute en phase de capture.
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
      // Les aperçus muets (boucles de survol / étagère / Redécouvrir) reprennent ; jamais le Viewer.
      doc
        .querySelectorAll<HTMLVideoElement>('video[autoplay]')
        .forEach((v) => v.muted && v.isConnected && void v.play().catch(() => undefined))
    }
  })
}
