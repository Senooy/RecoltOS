/**
 * Unified native drag: `dragstart` → `preventDefault`
 * → 128 px canvas → PNG dataURL → `recolt.startDrag(uuids, dataUrl)`. The flag
 * `ui.internalDrag` distinguishes an internal drag from a drop coming from the Finder.
 */
import { useUi } from '../state/ui'

export const DRAG_ICON_SIZE = 128

/**
 * Icon PNG (dataURL) drawn from the displayed thumbnail. The image must be served with
 * `Access-Control-Allow-Origin: *` and `crossOrigin="anonymous"` to avoid "tainting" the canvas.
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
    return undefined // tainted canvas: main uses drag-fallback.png
  }
}

/** To be wired to `onDragStart` of a card (or of the selection). */
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

/** Cleans up `internalDrag`: drop (capture), first `pointermove` without button, focus, Escape. */
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
    // Lets the internal target read `internalDrag` during its own `drop`.
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

/** Handlers of an internal drop target (collection, canvas, pill). */
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
      // Cleared AFTER propagation: the drop layer (window `drop` listener) still reads
      // `internalDrag` and does not import the files of the native drag (`installInternalDragCleanup`).
      setTimeout(() => useUi.getState().clearInternalDrag(), 0)
    },
  }
}
