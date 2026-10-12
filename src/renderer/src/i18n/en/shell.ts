/** English texts for the `shell` domain: app shell, library picker, generic dialogs. */
import type { Widen } from '../../../../shared/i18n/messages'
import type { shell as frShell } from '../fr/shell'

export const shell: Widen<typeof frShell> = {
  shell: {
    create: 'Create',
    rename: 'Rename',
    cancel: 'Cancel',
    confirm: 'Confirm',
    name: 'Name',
    librariesHeading: 'Libraries',
    newLibraryTitle: 'New Library',
    newLibraryDefault: 'My Library',
    selectionClear: 'Deselect All',
    addTo: 'Add to…',
    hide: 'Hide',
    download: 'Download',
    delete: 'Delete',
    restore: 'Restore',
    deleteForever: 'Delete Permanently',
    dropCollection: 'Drop into collection',
    unavailable: 'Not available in this version yet.',
  },
  uiKit: {
    remove: (label: string) => `Remove ${label}`,
    slide: (current: number, total: number) => `Slide ${current} of ${total}`,
    notifications: 'Notifications',
    dismiss: 'Dismiss notification',
    canvas: 'Canvas',
    recentSearch: (label: string, q: string) => `${label} “${q}”`,
  },
}
