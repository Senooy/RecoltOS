/** `updates.*` handlers: state, manual check, restart on the downloaded update (`updates/init.ts`). */
import { checkForUpdatesNow, getUpdateStatus, installUpdate } from '../../updates/init'
import type { DomainHandlers } from '../router'

export const updatesHandlers: DomainHandlers<'updates'> = {
  'updates.getStatus': () => getUpdateStatus(),
  'updates.check': () => checkForUpdatesNow(),
  'updates.install': () => {
    installUpdate()
  },
}
