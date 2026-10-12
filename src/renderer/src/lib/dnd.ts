/**
 * Glisser natif unifié (PLAN §1.12, DESIGN §4.6, ARCHI §2.5) : `dragstart` → `preventDefault`
 * → canvas 128 px → PNG dataURL → `recolt.startDrag(uuids, dataUrl)`. Le drapeau
 * `ui.internalDrag` distingue un glisser interne d'un dépôt venu du Finder.
 */
import { useUi } from '../state/ui'

export const DRAG_ICON_SIZE = 128

/**
 * Icône PNG (dataURL) dessinée depuis la vignette affichée. L'image doit être servie avec
 * `Access-Control-Allow-Origin: *` et `crossOrigin="anonymous"` pour ne pas « teinter » le canvas.
 */
export function dragIconFromImage(img: HTMLImageElement | null | undefined): string | undefined {
  if (!img || !img.complete || img.naturalWidth === 0) return undefined
  try {
    const canvas = document.createElement('canvas')
    canvas.width = DRAG_ICON_SIZE
    canvas.height = DRAG_ICON_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    const scale = Math.min(DRAG_ICON_SIZE / img.naturalWidth, DRAG_ICON_SIZE / img.naturalHeight)
    const w = img.naturalWidth * scale
    const h = img.naturalHeight * scale
    ctx.drawImage(img, (DRAG_ICON_SIZE - w) / 2, (DRAG_ICON_SIZE - h) / 2, w, h)
    return canvas.toDataURL('image/png')
  } catch {
    return undefined // canvas teinté : main utilise drag-fallback.png
  }
}

/** À brancher sur `onDragStart` d'une carte (ou de la sélection). */
export function startCardDrag(
  e: { preventDefault(): void },
  uuids: string[],
  img?: HTMLImageElement | null,
): void {
  e.preventDefault()
  if (uuids.length === 0) return
  useUi.getState().setInternalDrag(uuids)
  window.recolt?.startDrag(uuids, dragIconFromImage(img))
}

/** Nettoie `internalDrag` : drop (capture), premier `pointermove` sans bouton, focus, Échap. */
export function installInternalDragCleanup(target: Window = window): () => void {
  const clear = () => {
    if (useUi.getState().internalDrag) useUi.getState().clearInternalDrag()
  }
  const onPointer = (e: PointerEvent) => {
    if (e.buttons === 0) clear()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') clear()
  }
  const onDrop = () => {
    // Laisse la cible interne lire `internalDrag` pendant son propre `drop`.
    setTimeout(clear, 0)
  }
  target.addEventListener('drop', onDrop, true)
  target.addEventListener('pointermove', onPointer)
  target.addEventListener('focus', clear)
  target.addEventListener('keydown', onKey)
  return () => {
    target.removeEventListener('drop', onDrop, true)
    target.removeEventListener('pointermove', onPointer)
    target.removeEventListener('focus', clear)
    target.removeEventListener('keydown', onKey)
  }
}

/** Gestionnaires d'une cible de dépôt interne (collection, toile, pilule). */
export function internalDropTarget(
  onDropIds: (uuids: string[]) => void,
  setActive?: (active: boolean) => void,
) {
  return {
    onDragOver(e: { preventDefault(): void; dataTransfer: DataTransfer | null }) {
      if (!useUi.getState().internalDrag) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      setActive?.(true)
    },
    onDragLeave() {
      setActive?.(false)
    },
    onDrop(e: { preventDefault(): void }) {
      const ids = useUi.getState().internalDrag
      setActive?.(false)
      if (!ids) return
      e.preventDefault()
      onDropIds(ids)
      // Effacé APRÈS la propagation : le calque de dépôt (écouteur `drop` de la fenêtre) lit encore
      // `internalDrag` et n'importe pas les fichiers du glisser natif (`installInternalDragCleanup`).
      setTimeout(() => useUi.getState().clearInternalDrag(), 0)
    },
  }
}
