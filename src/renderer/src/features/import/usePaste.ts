/**
 * ⌘V in the library: root `paste` listener, ignored in an editable field or under an overlay;
 * the main process reads the clipboard (Finder files, image, URL).
 */
import { useEffect } from 'react'
import { isEditableTarget } from '../../lib/shortcuts'
import { useUi } from '../../state/ui'
import { pasteFromClipboard } from './import-actions'

export function usePaste(): void {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return
      const ui = useUi.getState()
      if (ui.overlay) return
      if (
        ui.route.name !== 'library' &&
        ui.route.name !== 'collection' &&
        ui.route.name !== 'search'
      )
        return
      e.preventDefault()
      void pasteFromClipboard(ui.route.name === 'collection' ? ui.route.uuid : undefined)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])
}
