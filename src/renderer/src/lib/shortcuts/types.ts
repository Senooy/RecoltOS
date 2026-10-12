/** Shortcut specific to a UI domain (renderer scope). */
import type { KeyMatch, Modifiers } from '../../../../shared/shortcuts'

export interface RendererShortcut {
  id: string
  label: string
  match: KeyMatch & Modifiers
  /** Disabled when an editable field has focus (default: true). */
  ignoreInFields?: boolean
}
