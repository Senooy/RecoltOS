/**
 * Menu natif FR construit depuis `src/shared/shortcuts.ts`. Chaque item porte
 * l'`id` de son raccourci (les scènes visuelles le déclenchent par `getMenuItemById`). Annuler,
 * Rétablir, Tout sélectionner et Zoom sont des items PERSONNALISÉS (pas de `role`) qui relaient
 * `evt:menu.command` : le renderer décide (champ texte → `system.edit`, sinon pile de l'app).
 * Zoom avant : `CmdOrCtrl+Plus` + item caché `CmdOrCtrl+=`. Couper/Copier/Coller gardent leur rôle.
 */
import { Menu, app, type MenuItemConstructorOptions } from 'electron'
import { SHORTCUTS, type MenuCommand } from '../shared/shortcuts'
import type { ServiceContext } from './bootstrap/context'

const accelOf = (id: string): string | undefined => {
  const s = SHORTCUTS.find((x) => x.id === id)
  return s?.accel ?? undefined
}

export interface MenuOverrides {
  /**
   * Accélérateur de « Capturer l'écran » : celui du réglage si la touche imprimée
   * correspond, `null` = aucun (le raccourci global reste actif).
   */
  capture?: string | null
}

export function buildMenuTemplate(
  send: (cmd: MenuCommand) => void,
  appName = 'RecoltOS',
  overrides: MenuOverrides = {},
): MenuItemConstructorOptions[] {
  const cmd = (
    id: MenuCommand,
    label: string,
    extra: Partial<MenuItemConstructorOptions> = {},
  ): MenuItemConstructorOptions => {
    const accelerator =
      id === 'capture' && overrides.capture !== undefined
        ? (overrides.capture ?? undefined)
        : accelOf(id)
    return {
      id,
      label,
      ...(accelerator ? { accelerator } : {}),
      click: () => send(id),
      ...extra,
    }
  }
  return [
    {
      label: appName,
      submenu: [
        { role: 'about', label: `À propos de ${appName}` },
        { type: 'separator' },
        cmd('settings', 'Réglages…'),
        { type: 'separator' },
        { role: 'services', label: 'Services' },
        { type: 'separator' },
        { role: 'hide', label: `Masquer ${appName}` },
        { role: 'hideOthers', label: 'Masquer les autres' },
        { role: 'unhide', label: 'Tout afficher' },
        { type: 'separator' },
        { role: 'quit', label: `Quitter ${appName}` },
      ],
    },
    {
      label: 'Fichier',
      submenu: [
        cmd('newCollection', 'Nouvelle collection'),
        cmd('newSpace', 'Nouveau space'),
        { type: 'separator' },
        cmd('importFiles', 'Importer des fichiers…'),
        cmd('capture', 'Capturer l’écran'),
        cmd('importFolder', 'Importer un dossier…'),
        cmd('importGatheros', 'Importer depuis GatherOS…'),
        { type: 'separator' },
        cmd('exportZip', 'Exporter la bibliothèque…'),
        cmd('snapshot', 'Créer un instantané de la bibliothèque'),
        { type: 'separator' },
        { role: 'close', label: 'Fermer la fenêtre' },
      ],
    },
    {
      label: 'Édition',
      submenu: [
        cmd('undo', 'Annuler'),
        cmd('redo', 'Rétablir'),
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        cmd('selectAll', 'Tout sélectionner'),
      ],
    },
    {
      label: 'Présentation',
      submenu: [
        cmd('palette', 'Palette de commandes'),
        cmd('quickLook', 'Aperçu rapide'),
        cmd('rediscover', 'Redécouvrir'),
        cmd('toggleDetails', 'Afficher/Masquer le panneau Détails'),
        { type: 'separator' },
        cmd('goLibrary', 'Bibliothèque'),
        cmd('goCollections', 'Collections'),
        cmd('goSpaces', 'Spaces'),
        cmd('search', 'Recherche'),
        { type: 'separator' },
        cmd('toggleTheme', 'Basculer le thème'),
        { type: 'separator' },
        cmd('zoomIn', 'Zoom avant'),
        // Item caché : `⌘=` (sans Maj) zoome aussi.
        {
          id: 'zoomInAlt',
          label: 'Zoom avant',
          accelerator: 'CmdOrCtrl+=',
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => send('zoomIn'),
        },
        cmd('zoomOut', 'Zoom arrière'),
        cmd('zoomReset', 'Taille réelle'),
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' },
        ...(app.isPackaged
          ? []
          : [
              {
                role: 'toggleDevTools',
                label: 'Outils de développement',
              } as MenuItemConstructorOptions,
            ]),
      ],
    },
    {
      label: 'Fenêtre',
      role: 'windowMenu',
      submenu: [
        { role: 'minimize', label: 'Réduire' },
        { role: 'zoom', label: 'Agrandir' },
        { type: 'separator' },
        { role: 'front', label: 'Tout ramener au premier plan' },
      ],
    },
    { label: 'Aide', role: 'help', submenu: [] },
  ]
}

let menuCtx: ServiceContext | null = null
let menuOverrides: MenuOverrides = {}

export function initMenu(ctx: ServiceContext): void {
  menuCtx = ctx
  rebuildMenu()
}

/** Reconstruit le menu natif (raccourci de capture modifié). */
export function rebuildMenu(overrides?: MenuOverrides): void {
  if (overrides) menuOverrides = { ...menuOverrides, ...overrides }
  const ctx = menuCtx
  if (!ctx || typeof Menu?.buildFromTemplate !== 'function') return
  const menu = Menu.buildFromTemplate(
    buildMenuTemplate(
      (cmd) => ctx.emit('menu.command', { cmd }),
      app.getName() || 'RecoltOS',
      menuOverrides,
    ),
  )
  Menu.setApplicationMenu(menu)
}
