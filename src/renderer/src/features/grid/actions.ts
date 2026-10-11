/**
 * Actions sur les éléments (menu contextuel, barre de sélection, glisser) avec toast et annulation
 * ⌘Z (ERRATA §C : corbeille, masquer, ajout / retrait de collection, couverture).
 */
import type { ItemCard } from '../../../../shared/dto/items'
import { toast } from '../../components/ui'
import { fr } from '../../i18n/fr'
import { RpcError, rpc } from '../../lib/rpc'
import { useUndo } from '../../state/undo'

function fail(err: unknown): void {
  const message = err instanceof RpcError ? err.message : fr.errors.generic
  toast(message)
}

function undoable(
  message: string,
  label: string,
  undo: () => Promise<unknown>,
  redo?: () => Promise<unknown>,
): void {
  const entry = {
    label,
    undo: async () => {
      await undo()
    },
    ...(redo ? { redo: async () => void (await redo()) } : {}),
  }
  useUndo.getState().push(entry)
  toast(message, {
    action: {
      label: fr.toast.undo,
      onClick: () => {
        void useUndo.getState().undo().catch(fail)
      },
    },
  })
}

export async function trashItems(uuids: string[]): Promise<void> {
  try {
    await rpc('items.trash', { uuids })
    undoable(
      fr.toast.trashed(uuids.length),
      'trash',
      () => rpc('items.restore', { uuids }),
      () => rpc('items.trash', { uuids }),
    )
  } catch (err) {
    fail(err)
  }
}

export async function restoreItems(uuids: string[]): Promise<void> {
  try {
    await rpc('items.restore', { uuids })
  } catch (err) {
    fail(err)
  }
}

export async function purgeItems(uuids: string[]): Promise<void> {
  try {
    await rpc('items.purge', { uuids })
  } catch (err) {
    fail(err)
  }
}

export async function setHidden(uuids: string[], hidden: boolean): Promise<void> {
  try {
    await rpc('items.setHidden', { uuids, hidden })
    if (hidden) {
      undoable(
        fr.toast.hidden,
        'hide',
        () => rpc('items.setHidden', { uuids, hidden: false }),
        () => rpc('items.setHidden', { uuids, hidden: true }),
      )
    }
  } catch (err) {
    fail(err)
  }
}

export async function addToCollection(
  collection: { uuid: string; name: string },
  uuids: string[],
): Promise<void> {
  try {
    await rpc('collections.addItems', { collectionUuid: collection.uuid, itemUuids: uuids })
    undoable(
      fr.toast.addedTo(collection.name),
      'collection.add',
      () => rpc('collections.removeItems', { collectionUuid: collection.uuid, itemUuids: uuids }),
      () => rpc('collections.addItems', { collectionUuid: collection.uuid, itemUuids: uuids }),
    )
  } catch (err) {
    fail(err)
  }
}

export async function removeFromCollection(
  collection: { uuid: string; name: string },
  uuids: string[],
): Promise<void> {
  try {
    await rpc('collections.removeItems', { collectionUuid: collection.uuid, itemUuids: uuids })
    undoable(fr.menu.removeFrom(collection.name), 'collection.remove', () =>
      rpc('collections.addItems', { collectionUuid: collection.uuid, itemUuids: uuids }),
    )
  } catch (err) {
    fail(err)
  }
}

export async function setCover(collectionUuid: string, itemUuid: string): Promise<void> {
  try {
    await rpc('collections.update', { uuid: collectionUuid, coverItemUuid: itemUuid })
  } catch (err) {
    fail(err)
  }
}

export async function copyFor(card: ItemCard): Promise<void> {
  try {
    if (card.kind === 'tweet') {
      const d = await rpc('items.get', { uuid: card.uuid })
      await rpc('system.copyText', { text: d.post?.text ?? d.title ?? '' })
    } else if (card.kind === 'url') {
      const d = await rpc('items.get', { uuid: card.uuid })
      if (d.sourceUrl) await rpc('system.copyText', { text: d.sourceUrl })
    } else {
      await rpc('system.copyImage', { itemUuid: card.uuid })
    }
    toast(fr.toast.copied)
  } catch (err) {
    fail(err)
  }
}

export async function openSource(card: ItemCard): Promise<void> {
  try {
    const d = await rpc('items.get', { uuid: card.uuid })
    if (d.sourceUrl) await rpc('system.openExternal', { url: d.sourceUrl })
  } catch (err) {
    fail(err)
  }
}

export async function reveal(card: ItemCard): Promise<void> {
  try {
    await rpc('system.revealInFinder', { itemUuid: card.uuid })
  } catch (err) {
    fail(err)
  }
}

export async function download(uuids: string[]): Promise<void> {
  for (const uuid of uuids) {
    try {
      const r = await rpc('system.saveAs', { itemUuid: uuid })
      if (!r) return
    } catch (err) {
      fail(err)
      return
    }
  }
}
