/**
 * Menu natif (français ou anglais, `src/main/i18n`) construit depuis `src/shared/shortcuts.ts`.
 * Reconstruit quand la langue change (`initMenu` suit `onLangChange`). Chaque item porte
 * l'`id` de son raccourci (les scènes visuelles le déclenchent par `getMenuItemById`). Annuler,
 * Rétablir, Tout sélectionner et Zoom sont des items PERSONNALISÉS (pas de `role`) qui relaient
 * `evt:menu.command` : le renderer décide (champ texte → `system.edit`, sinon pile de l'app).
 * Zoom avant : `CmdOrCtrl+Plus` + item caché `CmdOrCtrl+=`. Couper/Copier/Coller gardent leur rôle.
 */
import { Menu, app, type MenuItemConstructorOptions } from 'electron'
import { getLang, onLangChange, type Lang } from '../shared/i18n/lang'
import { SHORTCUTS, type MenuCommand } from '../shared/shortcuts'
import type { ServiceContext } from './bootstrap/context'
import { mt } from './i18n'

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
  lang: Lang = getLang(),
): MenuItemConstructorOptions[] {
  const m = mt(lang).menu
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
        { role: 'about', label: m.about(appName) },
        { type: 'separator' },
        cmd('settings', m.settings),
        { type: 'separator' },
        { role: 'services', label: m.services },
        { type: 'separator' },
        { role: 'hide', label: m.hide(appName) },
        { role: 'hideOthers', label: m.hideOthers },
        { role: 'unhide', label: m.showAll },
        { type: 'separator' },
        { role: 'quit', label: m.quit(appName) },
      ],
    },
    {
      label: m.file,
      submenu: [
        cmd('newCollection', m.newCollection),
        cmd('newSpace', m.newSpace),
        { type: 'separator' },
        cmd('importFiles', m.importFiles),
        cmd('capture', m.capture),
        cmd('importFolder', m.importFolder),
        cmd('importGatheros', m.importGatheros),
        { type: 'separator' },
        cmd('exportZip', m.exportLibrary),
        cmd('snapshot', m.snapshot),
        { type: 'separator' },
        { role: 'close', label: m.closeWindow },
      ],
    },
    {
      label: m.edit,
      submenu: [
        cmd('undo', m.undo),
        cmd('redo', m.redo),
        { type: 'separator' },
        { role: 'cut', label: m.cut },
        { role: 'copy', label: m.copy },
        { role: 'paste', label: m.paste },
        cmd('selectAll', m.selectAll),
      ],
    },
    {
      label: m.view,
      submenu: [
        cmd('palette', m.palette),
        cmd('quickLook', m.quickLook),
        cmd('rediscover', m.rediscover),
        cmd('toggleDetails', m.toggleDetails),
        { type: 'separator' },
        cmd('goLibrary', m.library),
        cmd('goCollections', m.collections),
        cmd('goSpaces', m.spaces),
        cmd('search', m.search),
        { type: 'separator' },
        cmd('toggleTheme', m.toggleTheme),
        { type: 'separator' },
        cmd('zoomIn', m.zoomIn),
        // Item caché : `⌘=` (sans Maj) zoome aussi.
        {
          id: 'zoomInAlt',
          label: m.zoomIn,
          accelerator: 'CmdOrCtrl+=',
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => send('zoomIn'),
        },
        cmd('zoomOut', m.zoomOut),
        cmd('zoomReset', m.zoomReset),
        { type: 'separator' },
        { role: 'togglefullscreen', label: m.fullscreen },
        ...(app.isPackaged
          ? []
          : [
              {
                role: 'toggleDevTools',
                label: m.devTools,
              } as MenuItemConstructorOptions,
            ]),
      ],
    },
    {
      label: m.window,
      role: 'windowMenu',
      submenu: [
        { role: 'minimize', label: m.minimize },
        { role: 'zoom', label: m.zoom },
        { type: 'separator' },
        { role: 'front', label: m.front },
      ],
    },
    { label: m.help, role: 'help', submenu: [] },
  ]
}

let menuCtx: ServiceContext | null = null
let menuOverrides: MenuOverrides = {}

export function initMenu(ctx: ServiceContext): () => void {
  menuCtx = ctx
  rebuildMenu()
  // Langue changée (réglage ou langue du système) : menu reconstruit aussitôt.
  const offLang = onLangChange(() => rebuildMenu())
  return () => {
    offLang()
    menuCtx = null
  }
}

/** Reconstruit le menu natif (raccourci de capture modifié, langue changée). */
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
