/**
 * Actions de niveau liste : créer (titre en édition à l'ouverture),
 * dupliquer, supprimer avec confirmation, « Ajouter à un space › » depuis une carte.
 */
import { toast } from '../../components/ui'
import { tr } from '../../i18n'
import { RpcError, rpc } from '../../lib/rpc'
import { askConfirm } from '../../state/dialogs'
import { useUi } from '../../state/ui'

const fail = (err: unknown) => toast(err instanceof RpcError ? err.message : tr.errors.generic)

const pendingRename = new Set<string>()

/** L'éditeur met le titre en édition une seule fois après une création. */
export function consumePendingRename(uuid: string): boolean {
  return pendingRename.delete(uuid)
}

export async function newSpace(open = true): Promise<string | null> {
  try {
    const { uuid } = await rpc('spaces.create', {})
    if (open) {
      pendingRename.add(uuid)
      useUi.getState().navigate({ name: 'space', uuid })
    }
    return uuid
  } catch (err) {
    fail(err)
    return null
  }
}

export async function duplicateSpace(uuid: string, _name: string, open = false): Promise<void> {
  try {
    const r = await rpc('spaces.duplicate', { uuid })
    if (open) useUi.getState().navigate({ name: 'space', uuid: r.uuid })
  } catch (err) {
    fail(err)
  }
}

export async function renameSpace(uuid: string, name: string): Promise<void> {
  try {
    await rpc('spaces.rename', { uuid, name })
  } catch (err) {
    fail(err)
  }
}

export async function deleteSpaceWithConfirm(
  uuid: string,
  name: string,
  after?: () => void,
): Promise<void> {
  const ok = await askConfirm({
    title: tr.spacesUi.deleteTitle(name || tr.spaces.untitled),
    body: tr.spacesUi.deleteBody,
    confirmLabel: tr.confirm.delete,
    danger: true,
  })
  if (!ok) return
  try {
    after?.()
    await rpc('spaces.delete', { uuid })
  } catch (err) {
    fail(err)
  }
}

/** « Ajouter à un space › » (menu contextuel des cartes) : grille à droite du contenu. */
export async function addItemsToSpace(
  space: { uuid: string; name: string },
  itemUuids: readonly string[],
): Promise<void> {
  if (itemUuids.length === 0) return
  try {
    const r = await rpc('spaces.addItems', { spaceUuid: space.uuid, itemUuids: [...itemUuids] })
    toast(tr.spacesUi.itemsAdded(r.added, space.name || tr.spaces.untitled), {
      action: {
        label: tr.spacesUi.open,
        onClick: () => useUi.getState().navigate({ name: 'space', uuid: space.uuid }),
      },
    })
  } catch (err) {
    fail(err)
  }
}

/** « Nouveau space… » depuis le menu d'une carte : crée, ajoute, sans quitter la vue. */
export async function addItemsToNewSpace(itemUuids: readonly string[]): Promise<void> {
  const uuid = await newSpace(false)
  if (uuid) await addItemsToSpace({ uuid, name: '' }, itemUuids)
}
