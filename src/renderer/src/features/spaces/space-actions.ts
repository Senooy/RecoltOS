/**
 * List-level actions: create (title in edit mode on opening), duplicate, delete with
 * confirmation, « Ajouter à un space › » from a card.
 */
import { toast } from '../../components/ui'
import { tr } from '../../i18n'
import { RpcError, rpc } from '../../lib/rpc'
import { askConfirm } from '../../state/dialogs'
import { useUi } from '../../state/ui'

const fail = (err: unknown) => toast(err instanceof RpcError ? err.message : tr.errors.generic)

const pendingRename = new Set<string>()

/** The editor puts the title in edit mode only once after a creation. */
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

/** « Ajouter à un space › » (context menu of cards): grid on the right of the content. */
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

/** « Nouveau space… » from a card's menu: creates and adds, without leaving the view. */
export async function addItemsToNewSpace(itemUuids: readonly string[]): Promise<void> {
  const uuid = await newSpace(false)
  if (uuid) await addItemsToSpace({ uuid, name: '' }, itemUuids)
}
