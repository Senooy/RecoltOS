/**
 * ⌘V dans la bibliothèque : écouteur `paste` racine, ignoré dans un champ éditable
 * ou sous un calque ; le MAIN lit le presse-papiers (fichiers du Finder, image, URL).
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
