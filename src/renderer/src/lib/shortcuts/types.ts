/** Raccourci propre à un domaine UI (portée renderer). Créé par WP-00. */
import type { KeyMatch, Modifiers } from '../../../../shared/shortcuts'

export interface RendererShortcut {
  id: string
  label: string
  match: KeyMatch & Modifiers
  /** Désactivé quand un champ éditable a le focus (défaut : vrai). */
  ignoreInFields?: boolean
}
