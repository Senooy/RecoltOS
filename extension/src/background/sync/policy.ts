/**
 * Choix de la cible d'exécution (remplace). L'ARRIÈRE-PLAN est toujours la
 * cible principale, pour les trois plateformes et tous les déclencheurs. Replis, seulement si la
 * requête d'arrière-plan est REFUSÉE (`blocked`) : un onglet de la plateforme déjà ouvert (jamais
 * rechargé ni mis au premier plan), puis un onglet créé en arrière-plan UNIQUEMENT si l'option
 * « Ouvrir un onglet en arrière-plan si besoin » est active (désactivée par défaut).
 */
import type { Trigger } from '../../../../src/shared/bridge/envelope'

export type ExecTarget =
  { kind: 'background' } | { kind: 'tab'; tabId: number } | { kind: 'created_tab' }

export interface PolicyInput {
  trigger: Trigger
  /** Onglet de la plateforme déjà ouvert et chargé, s'il y en a un. */
  existingTabId: number | null
  allowBackgroundTab: boolean
}

/** Cibles à essayer, dans l'ordre. */
export function targetsFor(p: PolicyInput): ExecTarget[] {
  const out: ExecTarget[] = [{ kind: 'background' }]
  if (p.existingTabId !== null) out.push({ kind: 'tab', tabId: p.existingTabId })
  if (p.allowBackgroundTab) out.push({ kind: 'created_tab' })
  return out
}
