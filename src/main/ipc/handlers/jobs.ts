/**
 * Handlers `jobs.*` : état par type, « Réessayer » les échecs, pause/reprise
 * (par type ou globale, persistée dans `settings['jobs.paused']`).
 */
import { AppError } from '../../../shared/errors'
import { getJobQueue, requireJobServices } from '../../jobs/runtime'
import type { DomainHandlers } from '../router'

function queue() {
  const q = getJobQueue()
  if (!q) throw new AppError('library_unavailable', 'File de jobs indisponible.')
  return q
}

export const jobsHandlers: DomainHandlers<'jobs'> = {
  'jobs.status': () => queue().status(),
  'jobs.retryFailed': ({ type }) => {
    const count = requireJobServices().lib.repos.jobs.requeueFailed(type)
    queue().kick()
    return { count }
  },
  'jobs.pause': ({ type }) => {
    queue().pauseType(type ?? null, null, 'user')
  },
  'jobs.resume': ({ type }) => {
    queue().resumeType(type ?? null)
  },
}
