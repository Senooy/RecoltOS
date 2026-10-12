/**
 * ⌘K palette commands: 15 entries (icon, label, shortcut), wired to
 * `runMenuCommand` (same path as the native menu); shortcuts read from `src/shared/shortcuts.ts`.
 */
import {
  Archive,
  Camera,
  ChartPie,
  Download,
  Folder,
  FolderPlus,
  Images,
  Layers,
  Moon,
  RefreshCw,
  Search,
  Settings,
  Shuffle,
  SquarePlus,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import {
  displayShortcutLabel,
  getShortcut,
  type MenuCommand,
  type ShortcutId,
} from '../../../../shared/shortcuts'
import { tr } from '../../i18n'

export interface PaletteCommand {
  id: string
  label: string
  Icon: LucideIcon
  /** Keys displayed (order: ⌘ then ⇧ then the letter). */
  keys: string[]
  run: MenuCommand | 'syncNow'
}

/** `⇧⌘N` (shortcut table) → `['⌘', '⇧', 'N']` (palette display). */
export function keysOf(id: ShortcutId): string[] {
  const label = displayShortcutLabel(getShortcut(id).label)
  const mods = ['⌘', '⇧', '⌥', '⌃'].filter((m) => label.includes(m))
  const rest = [...label].filter((ch) => !mods.includes(ch)).join('')
  return [...mods, rest]
}

const cmd = (
  id: string,
  label: string,
  Icon: LucideIcon,
  run: PaletteCommand['run'],
  shortcut: ShortcutId | null,
): PaletteCommand => ({ id, label, Icon, run, keys: shortcut ? keysOf(shortcut) : [] })

/** Palette commands, labels in the active language (recomputed on each call). */
export function paletteCommands(): readonly PaletteCommand[] {
  const c = tr.palette.cmd
  return [
    cmd('newCollection', c.newCollection, FolderPlus, 'newCollection', 'newCollection'),
    cmd('newSpace', c.newSpace, SquarePlus, 'newSpace', 'newSpace'),
    cmd('capture', c.capture, Camera, 'capture', 'capture'),
    cmd('rediscover', c.rediscover, Shuffle, 'rediscover', 'rediscover'),
    cmd('search', c.goSearch, Search, 'search', 'search'),
    cmd('goLibrary', c.goLibrary, Images, 'goLibrary', 'goLibrary'),
    cmd('goCollections', c.goCollections, Folder, 'goCollections', 'goCollections'),
    cmd('goSpaces', c.goSpaces, ChartPie, 'goSpaces', 'goSpaces'),
    cmd('importFiles', c.importFiles, Upload, 'importFiles', 'importFiles'),
    cmd('importGatheros', c.importGatheros, Archive, 'importGatheros', null),
    cmd('syncNow', c.syncNow, RefreshCw, 'syncNow', null),
    cmd('toggleTheme', c.toggleTheme, Moon, 'toggleTheme', 'toggleTheme'),
    cmd('exportZip', c.exportZip, Download, 'exportZip', null),
    cmd('snapshot', c.snapshot, Layers, 'snapshot', null),
    cmd('settings', c.settings, Settings, 'settings', 'settings'),
  ]
}

/** Fallback insensitive to case and accents. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Commands where a word starts with the input (or that contain it). */
export function matchCommands(q: string): PaletteCommand[] {
  const needle = fold(q.trim())
  const all = paletteCommands()
  if (!needle) return [...all]
  return all.filter((command) => {
    const label = fold(command.label)
    return label.split(/[\s'’]+/).some((w) => w.startsWith(needle)) || label.includes(needle)
  })
}
