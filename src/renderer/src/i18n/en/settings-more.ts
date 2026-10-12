/**
 * English texts for the `settings-more` domain: Settings › Tags, Storage, Data, extra Appearance
 * and About texts, zip export, snapshots and restore.
 */
import type { Widen } from '../../../../shared/i18n/messages'
import type { settingsMore as frSettingsMore } from '../fr/settings-more'
import { pluralEn } from '../plural'

export const settingsMore: Widen<typeof frSettingsMore> = {
  settingsMoreUi: {
    snapshotDone: 'Snapshot created',
    // Tags
    tagsDesc: 'Rename, merge or delete the tags in your library.',
    tagsEmpty: 'No tags yet.',
    tagsNoMatch: 'No matching tags.',
    tagCount: (n: number) => `${n} ${pluralEn(n, 'item', 'items')}`,
    tagActions: (name: string) => `Actions for the “${name}” tag`,
    tagNewTitle: 'New Tag',
    tagMergeTitle: (name: string) => `Merge “${name}” with…`,
    tagMergeDone: (into: string) => `Tags merged into “${into}”`,
    tagDeleteTitle: (name: string) => `Delete the “${name}” tag?`,
    tagDeleteBody: 'The items stay in your library; only the tag goes away.',
    tagCreated: (name: string) => `Tag “${name}” created`,
    // Storage
    storageDesc: 'Space this library takes up on your Mac.',
    storageTotal: (size: string) => `${size} total`,
    storageOther: 'Database and other',
    downloadRemoteDesc:
      'Avatars, quoted images and post slides are downloaded so they show up offline.',
    autoEmptyDesc: 'Items in the trash go to the macOS Trash.',
    regenDesc: 'Rebuilds thumbnails, large images, posters and video previews.',
    regenAction: 'Regenerate',
    regenStarted: (n: number) => `${n} ${pluralEn(n, 'preview', 'previews')} queued`,
    emptyNowDesc: (n: number) =>
      n === 0 ? 'The trash is empty.' : `${n} ${pluralEn(n, 'item', 'items')} in the trash.`,
    emptyAction: 'Empty',
    // Data
    dataDesc: 'Back up, export or restore your library.',
    exportDesc: 'Originals, database and readable metadata (items.jsonl) in a single archive.',
    exportAction: 'Export…',
    exportProgress: (done: string, total: string) => `Export: ${done} / ${total}`,
    snapshotsGroup: 'Snapshots',
    snapshotDesc: 'A copy of the database only (files are never modified).',
    snapshotAction: 'Create',
    snapshotsEmpty: 'No snapshots yet.',
    restoreTitle: 'Restore this snapshot?',
    restoreBody:
      'The current database is first set aside in a “before restore” snapshot. Files don’t move.',
    restoreConfirm: 'Restore',
    restoreDone: 'Snapshot restored',
    reasons: {
      manual: 'manual',
      daily: 'daily',
      'pre-import': 'before import',
      'pre-purge': 'before purge',
      'pre-restore': 'before restore',
    },
    reasonPreMigration: (v: string) => `before migration v${v}`,
    importDesc: 'Copy your items, collections, tags and notes from GatherOS.',
    importAction: 'Import…',
    openFolderDesc: 'The active library’s folder in Finder.',
    openFolderAction: 'Open',
    verifyAction: 'Check Library',
    verifyOk: 'Library checked: no problems.',
    verifyIssues: (n: number) => `${n} ${pluralEn(n, 'problem', 'problems')} found`,
    // About
    licensesTitle: 'Open Source Licenses',
    licensesBody:
      'RecoltOS is built on Electron, React, SQLite (better-sqlite3), sharp, Radix UI, cmdk, Tailwind CSS, lucide, motion, zod, zustand and yazl, under the MIT, Apache 2.0, BSD or ISC licenses.',
  },
}
