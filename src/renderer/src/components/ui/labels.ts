/**
 * Libellés internes du kit UI (accessibilité : noms accessibles, infobulles). Les textes de
 * `i18n/fr` sont réutilisés quand ils existent ; le reste est propre au kit (tutoiement, FR).
 */
import { fr } from '../../i18n/fr'

export const UI_LABELS = {
  close: fr.viewer.close,
  loading: fr.app.loading,
  remove: (label: string) => `Retirer ${label}`,
  video: fr.card.video,
  gif: fr.card.gif,
  slide: (current: number, total: number) => `Diapositive ${current} sur ${total}`,
  notifications: 'Notifications',
  dismiss: 'Ignorer la notification',
} as const
