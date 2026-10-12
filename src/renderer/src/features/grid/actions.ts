/**
 * Actions sur les éléments (menu contextuel, barre de sélection, glisser) avec toast et annulation
 * ⌘Z (corbeille, masquer, ajout / retrait de collection, couverture).
 */
import type { ItemCard } from '../../../../shared/dto/items'
import { toast } from '../../components/ui'
import { tr } from '../../i18n'
import { RpcError, rpc } from '../../lib/rpc'
import { useUndo } from '../../state/undo'

function fail(err: unknown): void {
  const message = err instanceof RpcError ? err.message : tr.errors.generic
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
      label: tr.toast.undo,
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
      tr.toast.trashed(uuids.length),
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
        tr.toast.hidden,
        'hide',
        () => rpc('items.setHidden', { uuids, hidden: false }),
        () => rpc('items.setHidden', { uuids, hidden: true }),
      )
    }
  } catch (err) {
    fail(err)
  }
}

/** Au-delà, l'appartenance préalable n'est pas relue (l'annulation retire alors toute la sélection). */
export const MEMBERSHIP_CHECK_MAX = 200

/** Éléments déjà membres directs de la collection (relus seulement pour une sélection multiple). */
async function alreadyIn(collectionUuid: string, uuids: readonly string[]): Promise<Set<string>> {
  if (uuids.length < 2 || uuids.length > MEMBERSHIP_CHECK_MAX) return new Set()
  const details = await Promise.all(
    uuids.map((uuid) => rpc('items.get', { uuid }).catch(() => null)),
  )
  return new Set(
    details
      .filter((d) => d?.collections.some((c) => c.uuid === collectionUuid))
      .map((d) => d!.uuid),
  )
}

/**
 * Ajoute à une collection ; renvoie le nombre d'éléments réellement ajoutés. Un élément déjà
 * présent n'est ni ajouté deux fois (`INSERT OR IGNORE`) ni retiré par ⌘Z : l'annulation ne porte
 * que sur les nouveaux membres. Rien d'ajouté : toast « Déjà dans … », pas d'entrée d'annulation.
 */
export async function addToCollection(
  collection: { uuid: string; name: string },
  uuids: string[],
): Promise<number> {
  try {
    const before = await alreadyIn(collection.uuid, uuids)
    const { count } = await rpc('collections.addItems', {
      collectionUuid: collection.uuid,
      itemUuids: uuids,
    })
    if (count === 0) {
      toast(tr.gridUi.alreadyIn(collection.name))
      return 0
    }
    const kept = count < uuids.length ? uuids.filter((u) => !before.has(u)) : uuids
    const fresh = kept.length > 0 ? kept : uuids
    undoable(
      tr.toast.addedTo(collection.name),
      'collection.add',
      () => rpc('collections.removeItems', { collectionUuid: collection.uuid, itemUuids: fresh }),
      () => rpc('collections.addItems', { collectionUuid: collection.uuid, itemUuids: fresh }),
    )
    return count
  } catch (err) {
    fail(err)
    return 0
  }
}

export async function removeFromCollection(
  collection: { uuid: string; name: string },
  uuids: string[],
): Promise<void> {
  try {
    await rpc('collections.removeItems', { collectionUuid: collection.uuid, itemUuids: uuids })
    undoable(tr.menu.removeFrom(collection.name), 'collection.remove', () =>
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
    toast(tr.toast.copied)
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
