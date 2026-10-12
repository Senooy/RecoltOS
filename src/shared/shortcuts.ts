/**
 * Source UNIQUE des raccourcis : le menu natif, le renderer
 * et le raccourci global lisent cette table. Un raccourci `menu` n'est jamais rebindé
 * côté renderer (l'accélérateur du menu consomme la touche), sauf repli explicite `rendererFallback`.
 *
 * AZERTY : chiffres comparés par `e.code` (`Digit1`…), lettres par `e.key.toLowerCase()`.
 */
import { getLang } from './i18n/lang'

export type ShortcutScope = 'menu' | 'renderer' | 'global'

export type KeyMatch =
  /** Lettre imprimée (`e.key.toLowerCase()`, ou `getLayoutMap()`), jamais `e.code`. */
  | { kind: 'letter'; key: string }
  /** Chiffre par position physique (`e.code === 'Digit<n>'`, `e.key === '<n>'` accepté). */
  | { kind: 'digit'; digit: number }
  /** Touche nommée (`e.key`) : Escape, ArrowLeft, Backspace, ' '… */
  | { kind: 'key'; key: string }
  /** Zoom : '+', '=', `Equal`, `NumpadAdd` / '-', `Minus`, `NumpadSubtract`. */
  | { kind: 'zoom'; dir: 'in' | 'out' }

export interface Modifiers {
  meta?: boolean
  shift?: boolean
  alt?: boolean
  ctrl?: boolean
}

export interface ShortcutDef {
  id: string
  /** Accélérateur Electron (menu / global), `null` pour un raccourci renderer pur. */
  accel: string | null
  /** Accélérateur caché supplémentaire (ex. `CmdOrCtrl+=` pour le zoom avant). */
  hiddenAccel?: string
  /** Libellé affiché (glyphes macOS). */
  label: string
  scope: ShortcutScope
  match: KeyMatch & Modifiers
  /** Le renderer gère aussi la touche (ex. ⌘1/2/3 si le menu ne la reçoit pas). */
  rendererFallback?: boolean
}

export const SHORTCUTS = [
  {
    id: 'palette',
    accel: 'CmdOrCtrl+K',
    label: '⌘K',
    scope: 'menu',
    match: { kind: 'letter', key: 'k', meta: true },
  },
  {
    id: 'search',
    accel: 'CmdOrCtrl+F',
    label: '⌘F',
    scope: 'menu',
    match: { kind: 'letter', key: 'f', meta: true },
  },
  {
    id: 'goLibrary',
    accel: 'CmdOrCtrl+1',
    label: '⌘1',
    scope: 'menu',
    match: { kind: 'digit', digit: 1, meta: true },
    rendererFallback: true,
  },
  {
    id: 'goCollections',
    accel: 'CmdOrCtrl+2',
    label: '⌘2',
    scope: 'menu',
    match: { kind: 'digit', digit: 2, meta: true },
    rendererFallback: true,
  },
  {
    id: 'goSpaces',
    accel: 'CmdOrCtrl+3',
    label: '⌘3',
    scope: 'menu',
    match: { kind: 'digit', digit: 3, meta: true },
    rendererFallback: true,
  },
  {
    id: 'newCollection',
    accel: 'CmdOrCtrl+N',
    label: '⌘N',
    scope: 'menu',
    match: { kind: 'letter', key: 'n', meta: true },
  },
  {
    id: 'newSpace',
    accel: 'CmdOrCtrl+Shift+N',
    label: '⇧⌘N',
    scope: 'menu',
    match: { kind: 'letter', key: 'n', meta: true, shift: true },
  },
  {
    id: 'capture',
    accel: 'CommandOrControl+Shift+S',
    label: '⇧⌘S',
    scope: 'global',
    match: { kind: 'letter', key: 's', meta: true, shift: true },
  },
  {
    id: 'rediscover',
    accel: 'CmdOrCtrl+Shift+R',
    label: '⇧⌘R',
    scope: 'menu',
    match: { kind: 'letter', key: 'r', meta: true, shift: true },
  },
  {
    id: 'toggleTheme',
    accel: 'CmdOrCtrl+Shift+L',
    label: '⇧⌘L',
    scope: 'menu',
    match: { kind: 'letter', key: 'l', meta: true, shift: true },
  },
  {
    id: 'settings',
    accel: 'CmdOrCtrl+,',
    label: '⌘,',
    scope: 'menu',
    match: { kind: 'key', key: ',', meta: true },
  },
  {
    id: 'importFiles',
    accel: 'CmdOrCtrl+O',
    label: '⌘O',
    scope: 'menu',
    match: { kind: 'letter', key: 'o', meta: true },
  },
  {
    id: 'toggleDetails',
    accel: 'CmdOrCtrl+I',
    label: '⌘I',
    scope: 'menu',
    match: { kind: 'letter', key: 'i', meta: true },
  },
  {
    id: 'undo',
    accel: 'CmdOrCtrl+Z',
    label: '⌘Z',
    scope: 'menu',
    match: { kind: 'letter', key: 'z', meta: true },
  },
  {
    id: 'redo',
    accel: 'CmdOrCtrl+Shift+Z',
    label: '⇧⌘Z',
    scope: 'menu',
    match: { kind: 'letter', key: 'z', meta: true, shift: true },
  },
  {
    id: 'selectAll',
    accel: 'CmdOrCtrl+A',
    label: '⌘A',
    scope: 'menu',
    match: { kind: 'letter', key: 'a', meta: true },
  },
  {
    id: 'zoomIn',
    accel: 'CmdOrCtrl+Plus',
    hiddenAccel: 'CmdOrCtrl+=',
    label: '⌘+',
    scope: 'menu',
    match: { kind: 'zoom', dir: 'in', meta: true },
  },
  {
    id: 'zoomOut',
    accel: 'CmdOrCtrl+-',
    label: '⌘−',
    scope: 'menu',
    match: { kind: 'zoom', dir: 'out', meta: true },
  },
  {
    id: 'zoomReset',
    accel: 'CmdOrCtrl+0',
    label: '⌘0',
    scope: 'menu',
    match: { kind: 'digit', digit: 0, meta: true },
  },
  {
    id: 'quickLook',
    accel: null,
    label: 'Espace',
    scope: 'renderer',
    match: { kind: 'key', key: ' ' },
  },
  {
    id: 'previous',
    accel: null,
    label: '←',
    scope: 'renderer',
    match: { kind: 'key', key: 'ArrowLeft' },
  },
  {
    id: 'next',
    accel: null,
    label: '→',
    scope: 'renderer',
    match: { kind: 'key', key: 'ArrowRight' },
  },
  {
    id: 'trash',
    accel: null,
    label: '⌘⌫',
    scope: 'renderer',
    match: { kind: 'key', key: 'Backspace', meta: true },
  },
  {
    id: 'close',
    accel: null,
    label: 'Échap',
    scope: 'renderer',
    match: { kind: 'key', key: 'Escape' },
  },
] as const satisfies readonly ShortcutDef[]

export type ShortcutId = (typeof SHORTCUTS)[number]['id']

export const SHORTCUT_IDS = SHORTCUTS.map((s) => s.id) as readonly ShortcutId[]

/**
 * Commandes que le menu natif relaie au renderer via `evt:menu.command` (toutes les entrées
 * `scope: 'menu'` + quelques items de menu sans raccourci). Testé contre `SHORTCUTS`.
 */
export const MENU_COMMANDS = [
  'palette',
  'search',
  'goLibrary',
  'goCollections',
  'goSpaces',
  'newCollection',
  'newSpace',
  'capture',
  'rediscover',
  'toggleTheme',
  'settings',
  'importFiles',
  'toggleDetails',
  'undo',
  'redo',
  'selectAll',
  'zoomIn',
  'zoomOut',
  'zoomReset',
  'quickLook',
  'importGatheros',
  'importFolder',
  'pasteUrl',
  'exportZip',
  'snapshot',
] as const
export type MenuCommand = (typeof MENU_COMMANDS)[number]

/** Libellé affiché d'un raccourci : glyphes identiques, seule la touche Échap se traduit (« Esc »). */
export function displayShortcutLabel(label: string): string {
  return label === 'Échap' && getLang() !== 'fr' ? 'Esc' : label
}

export function getShortcut(id: ShortcutId): ShortcutDef {
  const s = SHORTCUTS.find((d) => d.id === id)
  if (!s) throw new Error(`raccourci inconnu : ${id}`)
  return s
}

/**
 * Éditeur Spaces : lettres = touche imprimée (`baseChar`), chiffres = `e.code`.
 * Pas de ⌘1 pour « 100 % » (⌘1 = Bibliothèque).
 */
export const SPACES_SHORTCUTS = [
  { id: 'tool.select', label: 'V', match: { kind: 'letter', key: 'v' } },
  { id: 'tool.hand', label: 'H', match: { kind: 'letter', key: 'h' } },
  { id: 'tool.note', label: 'N', match: { kind: 'letter', key: 'n' } },
  { id: 'tool.text', label: 'T', match: { kind: 'letter', key: 't' } },
  { id: 'tool.rect', label: 'R', match: { kind: 'letter', key: 'r' } },
  { id: 'tool.ellipse', label: 'O', match: { kind: 'letter', key: 'o' } },
  { id: 'tool.image', label: 'I', match: { kind: 'letter', key: 'i' } },
  { id: 'drawer', label: 'L', match: { kind: 'letter', key: 'l' } },
  { id: 'undo', label: '⌘Z', match: { kind: 'letter', key: 'z', meta: true } },
  { id: 'redo', label: '⇧⌘Z', match: { kind: 'letter', key: 'z', meta: true, shift: true } },
  { id: 'redoAlt', label: '⌘Y', match: { kind: 'letter', key: 'y', meta: true } },
  { id: 'selectAll', label: '⌘A', match: { kind: 'letter', key: 'a', meta: true } },
  { id: 'deselect', label: 'Échap', match: { kind: 'key', key: 'Escape' } },
  { id: 'copy', label: '⌘C', match: { kind: 'letter', key: 'c', meta: true } },
  { id: 'cut', label: '⌘X', match: { kind: 'letter', key: 'x', meta: true } },
  { id: 'paste', label: '⌘V', match: { kind: 'letter', key: 'v', meta: true } },
  { id: 'duplicate', label: '⌘D', match: { kind: 'letter', key: 'd', meta: true } },
  { id: 'delete', label: '⌫', match: { kind: 'key', key: 'Backspace' } },
  { id: 'deleteForward', label: '⌦', match: { kind: 'key', key: 'Delete' } },
  {
    id: 'bringForward',
    label: '⌥⌘↑',
    match: { kind: 'key', key: 'ArrowUp', meta: true, alt: true },
  },
  {
    id: 'sendBackward',
    label: '⌥⌘↓',
    match: { kind: 'key', key: 'ArrowDown', meta: true, alt: true },
  },
  {
    id: 'bringToFront',
    label: '⇧⌥⌘↑',
    match: { kind: 'key', key: 'ArrowUp', meta: true, alt: true, shift: true },
  },
  {
    id: 'sendToBack',
    label: '⇧⌥⌘↓',
    match: { kind: 'key', key: 'ArrowDown', meta: true, alt: true, shift: true },
  },
  { id: 'lock', label: '⇧⌘L', match: { kind: 'letter', key: 'l', meta: true, shift: true } },
  { id: 'alignLeft', label: '⌥A', match: { kind: 'letter', key: 'a', alt: true } },
  { id: 'alignRight', label: '⌥D', match: { kind: 'letter', key: 'd', alt: true } },
  { id: 'alignTop', label: '⌥W', match: { kind: 'letter', key: 'w', alt: true } },
  { id: 'alignBottom', label: '⌥S', match: { kind: 'letter', key: 's', alt: true } },
  { id: 'alignCenterH', label: '⌥H', match: { kind: 'letter', key: 'h', alt: true } },
  { id: 'alignCenterV', label: '⌥V', match: { kind: 'letter', key: 'v', alt: true } },
  { id: 'distributeH', label: '⌃⌥H', match: { kind: 'letter', key: 'h', alt: true, ctrl: true } },
  { id: 'distributeV', label: '⌃⌥V', match: { kind: 'letter', key: 'v', alt: true, ctrl: true } },
  { id: 'zoomIn', label: '⌘+', match: { kind: 'zoom', dir: 'in', meta: true } },
  { id: 'zoomOut', label: '⌘−', match: { kind: 'zoom', dir: 'out', meta: true } },
  { id: 'zoom100', label: '⌘0', match: { kind: 'digit', digit: 0, meta: true } },
  { id: 'fitAll', label: '⇧1', match: { kind: 'digit', digit: 1, shift: true } },
  { id: 'fitSelection', label: '⇧2', match: { kind: 'digit', digit: 2, shift: true } },
] as const satisfies readonly { id: string; label: string; match: KeyMatch & Modifiers }[]

export type SpacesShortcutId = (typeof SPACES_SHORTCUTS)[number]['id']
