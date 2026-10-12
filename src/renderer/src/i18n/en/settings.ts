/** English texts for the `settings` domain: Settings window, Libraries section, GatherOS import. */
import type { Widen } from '../../../../shared/i18n/messages'
import type { settings as frSettings } from '../fr/settings'
import { pluralEn } from '../plural'

const n = (k: number, one: string, many: string) => `${k} ${pluralEn(k, one, many)}`

export const settings: Widen<typeof frSettings> = {
  settingsUi: {
    placeholder: 'This section is coming in a future version.',
    libraryMenu: 'Library actions',
    active: 'Active',
    switchTo: 'Open',
    reveal: 'Show in Finder',
    remove: 'Remove from List',
    removeTitle: (name: string) => `Remove “${name}” from the list?`,
    removeBody: 'The folder and its files stay on your Mac.',
    itemsAndSize: (items: number, size: string) => `${n(items, 'item', 'items')} · ${size}`,
  },
  importUi: {
    detecting: 'Looking for GatherOS…',
    notFound: 'No GatherOS library found on this Mac.',
    found: (name: string) => `GatherOS library found: ${name}`,
    summary: (items: number, images: number, videos: number, posts: number, links: number) =>
      `${n(items, 'importable item', 'importable items')} (${n(images, 'image', 'images')}, ${n(videos, 'video', 'videos')}, ${n(posts, 'post', 'posts')}, ${n(links, 'link', 'links')})`,
    collectionsAndSize: (c: number, size: string) =>
      `${n(c, 'collection', 'collections')}, ${size}`,
    running: 'Quit GatherOS to import.',
    retry: 'Try Again',
    options: 'Options',
    includeTrash: (k: number) => `Include Trash (${k})`,
    includeHidden: (k: number) => `Include hidden items (${k})`,
    aiFields: 'Keep titles, descriptions and OCR',
    prefs: 'Also bring over my GatherOS settings (the AI provider stays off)',
    skipStarter: (k: number) => `Skip the starter examples (${k})`,
    advanced: 'Advanced',
    ignoreTombstones: 'Recreate items deleted since the last import',
    target: 'Destination',
    targetActive: 'Active library',
    targetNew: 'New library “Imported from GatherOS”',
    start: 'Import',
    cancel: 'Cancel',
    close: 'Close',
    phases: {
      detect: 'Detection',
      snapshot: 'Copying the database',
      plan: 'Preparing',
      authors: 'Authors',
      items: 'Database',
      files: 'Files',
      collections: 'Collections',
      tags: 'Tags',
      tombstones: 'Rejected items',
      jobs: 'Remote media and avatars',
      finalize: 'Finishing',
      done: 'Done',
    },
    derived: (d: number, t: number) => `Previews: ${d} / ${t}`,
    doneTitle: 'Import complete',
    cancelled: 'Import cancelled.',
    failed: 'The import failed.',
    counts: (items: number, collections: number, skipped: number) =>
      `${n(items, 'item imported', 'items imported')}, ${n(collections, 'collection', 'collections')}, ${n(skipped, 'already there', 'already there')}`,
    missingFiles: (k: number) => `See items without a file (${k})`,
    urlDuplicates: (k: number) => `See URL duplicates (${k})`,
    openReport: 'Open Report',
    enrich: (k: number) => `Enrich ${n(k, 'item', 'items')} with AI…`,
    enrichOff: 'Turn on an engine first in Settings › AI.',
    goAi: 'Settings › AI',
    resumeTitle: 'A GatherOS import was interrupted',
    resume: 'Resume Import',
    duplicatesTitle: 'URL duplicates',
    missingTitle: 'Items without a file',
  },
}
