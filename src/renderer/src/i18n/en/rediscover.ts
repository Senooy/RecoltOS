/** English texts for the `rediscover` domain. */
import type { Widen } from '../../../../shared/i18n/messages'
import type { rediscover as frRediscover } from '../fr/rediscover'

export const rediscover: Widen<typeof frRediscover> = {
  rediscoverUi: {
    label: 'Rediscover',
    close: 'Quit Rediscover',
    suggested: 'Recent',
    all: 'All collections',
    filter: 'Filter…',
    newCollection: 'New Collection…',
    kept: 'Kept',
    trashed: 'Moved to Trash',
    addedTo: (name: string) => `Added to ${name}`,
    skipped: 'Skipped',
    undone: 'Action undone',
    nothingToUndo: 'Nothing to undo',
    empty: 'Nothing to rediscover right now.',
  },
}
