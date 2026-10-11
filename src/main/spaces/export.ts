/**
 * Export PNG d'un space (SPACES §1.9) : livré par WP-63 (fenêtre stage). Stub en attendant.
 */
import { AppError } from '../../shared/errors'
import type { HandlerContext } from '../ipc/router'

export function exportSpacePng(_input: unknown, _ctx: HandlerContext): never {
  throw new AppError('not_implemented', 'Export PNG pas encore disponible.')
}

export function cancelExport(): void {
  // rien à annuler
}
