/**
 * English texts for the `capture` domain: Settings › Capture, permission guide, capture feedback,
 * import (drop, paste, URL, add menu).
 */
import type { Widen } from '../../../../shared/i18n/messages'
import type { capture as frCapture } from '../fr/capture'
import { pluralEn } from '../plural'

export const capture: Widen<typeof frCapture> = {
  captureUi: {
    desc: 'Set the global screen capture shortcut and where captures land. A new shortcut applies right away.',
    recordHelp: 'Records the next key combination. Esc cancels.',
    recording: 'Press the combination…',
    record: 'Change the global shortcut',
    reset: 'Reset',
    errors: {
      taken: 'This shortcut is already used by another app.',
      reserved: 'This shortcut is reserved by macOS.',
      invalid: 'Add at least ⌘, ⌃ or ⌥ to a key.',
      unsupported: 'Unsupported combination.',
    },
    saveAsWarning:
      'Global shortcut: it replaces “Save As…” (⇧⌘S) in other apps while RecoltOS is running.',
    dropFolderEmpty: 'Library only',
    dropError: (code: string) => `Last copy failed (${code}).`,
    mode: 'Capture mode',
    modes: { region: 'Area', window: 'Window', screen: 'Screen' },
    notify: 'Notification after capture',
    hideApp: 'Hide RecoltOS during capture',
    copy: 'Also copy to the clipboard',
    permission: 'Screen Recording',
    granted: 'Allowed',
    denied: 'Not allowed',
    openPane: 'Open System Settings',
    recheck: 'Check Again',
    staleHint:
      'If captures only show the wallpaper: remove RecoltOS from the list with the − button, relaunch the app and allow it again.',
    guideTitle: 'Allow screen recording',
    guideBody:
      'To capture the screen, macOS asks for the “Screen & System Audio Recording” permission (exact wording depends on your version).',
    guideStep1: 'Open System Settings',
    guideStep2: (dev: boolean) =>
      dev ? 'Turn on Electron (or your terminal) in the list' : 'Turn on RecoltOS in the list',
    guideStep3: 'Come back here and relaunch RecoltOS',
    guideAdhoc:
      'This copy of RecoltOS is signed “ad hoc”: macOS won’t remember the permission from one version to the next. See the signing guide.',
    guideGranted: 'Permission granted',
    retry: 'Try Capture Again',
    view: 'View',
    undo: 'Undo',
    cancelled: 'Capture cancelled',
  },
  importUiMore: {
    report: (added: number, dup: number, failed: number) =>
      `${added} added · ${dup} ${pluralEn(dup, 'duplicate', 'duplicates')} · ${failed} ${pluralEn(failed, 'failure', 'failures')}`,
    progress: (done: number, total: number) => `Importing… ${done} / ${total}`,
    importFolder: 'Import Folder…',
    pasteUrl: 'Paste a URL…',
    addTo: (name: string) => `Add to “${name}”`,
    urlLabel: 'Page or media URL',
    urlPlaceholder: 'https://…',
    urlAdd: 'Add',
    urlInvalid: 'Enter a valid http(s) address.',
    urlFailed: 'Couldn’t fetch this page.',
    nothingToPaste: 'Nothing to paste: copy an image, a file or a URL.',
  },
}
