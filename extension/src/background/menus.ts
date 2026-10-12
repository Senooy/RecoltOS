/**
 * Menu contextuel : « Enregistrer dans RecoltOS », « Enregistrer dans la collection › »
 * (10 collections les plus récemment utilisées), « Autre collection… ». Pas d'entrée « sélection ».
 */
import type { BridgeCollection } from '../../../src/shared/bridge/save'
import { api } from '../lib/api'

export const MENU = {
  save: 'rcl-save',
  saveTo: 'rcl-save-to',
  more: 'rcl-col-more',
  colPrefix: 'rcl-col-',
} as const

export const MENU_TITLES = {
  save: 'Enregistrer dans RecoltOS',
  saveTo: 'Enregistrer dans la collection',
  more: 'Autre collection…',
} as const

const CONTEXTS = ['image', 'video', 'link', 'page'] as const

export interface MenuItemDef {
  id: string
  title: string
  parentId?: string
}

export function menuItems(collections: readonly BridgeCollection[]): MenuItemDef[] {
  const items: MenuItemDef[] = [
    { id: MENU.save, title: MENU_TITLES.save },
    { id: MENU.saveTo, title: MENU_TITLES.saveTo },
  ]
  for (const c of collections.slice(0, 10)) {
    items.push({
      id: `${MENU.colPrefix}${c.id}`,
      title: c.name.slice(0, 60),
      parentId: MENU.saveTo,
    })
  }
  items.push({ id: MENU.more, title: MENU_TITLES.more, parentId: MENU.saveTo })
  return items
}

let building: Promise<void> = Promise.resolve()

/** Reconstruit le menu (sérialisé : deux appels rapprochés ne se chevauchent pas). */
export function setupMenus(collections: readonly BridgeCollection[]): Promise<void> {
  building = building
    .then(async () => {
      const menus = api().contextMenus
      await menus.removeAll()
      for (const it of menuItems(collections)) {
        menus.create({
          id: it.id,
          title: it.title,
          contexts: [...CONTEXTS],
          ...(it.parentId ? { parentId: it.parentId } : {}),
        })
      }
    })
    .catch(() => undefined)
  return building
}

export function parseMenuId(
  id: string | number,
): { collectionId: string | null; more: boolean } | null {
  const s = String(id)
  if (s === MENU.save) return { collectionId: null, more: false }
  if (s === MENU.more) return { collectionId: null, more: true }
  if (s.startsWith(MENU.colPrefix))
    return { collectionId: s.slice(MENU.colPrefix.length), more: false }
  return null
}
