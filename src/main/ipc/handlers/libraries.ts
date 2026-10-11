/**
 * Handlers `libraries.*` (ERRATA §B, WP-02) : liste, création (dossiers iCloud / Dropbox refusés),
 * bascule, ouverture d'un dossier existant, renommage, retrait (fichiers conservés), affichage
 * dans le Finder.
 */
import { BrowserWindow, dialog, shell, type OpenDialogOptions } from 'electron'
import { AppError } from '../../../shared/errors'
import { getLibraryManager } from '../../library/init'
import type { LibraryManager } from '../../library/library-manager'
import type { DomainHandlers } from '../router'

function manager(): LibraryManager {
  const m = getLibraryManager()
  if (!m) throw new AppError('library_unavailable', 'Gestionnaire de bibliothèques indisponible.')
  return m
}

export const librariesHandlers: DomainHandlers<'libraries'> = {
  'libraries.list': () => manager().list(),

  'libraries.create': (input) =>
    manager().create(input.path ? { name: input.name, path: input.path } : { name: input.name }),

  'libraries.switch': async ({ id }) => {
    await manager().switch(id)
  },

  'libraries.openFolder': async (_input, ctx) => {
    const options: OpenDialogOptions = {
      title: 'Ouvrir une bibliothèque',
      buttonLabel: 'Ouvrir',
      properties: ['openDirectory'],
    }
    const win = ctx.sender ? BrowserWindow.fromWebContents(ctx.sender) : null
    const res = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    const dir = res.filePaths[0]
    if (res.canceled || !dir) return null
    return manager().addExisting(dir)
  },

  'libraries.rename': ({ id, name }) => manager().rename(id, name),

  'libraries.remove': ({ id }) => {
    manager().remove(id)
  },

  'libraries.reveal': async ({ id }) => {
    const err = await shell.openPath(manager().rootOf(id))
    if (err) throw new AppError('io', `Impossible d'ouvrir le dossier : ${err}`)
  },
}
