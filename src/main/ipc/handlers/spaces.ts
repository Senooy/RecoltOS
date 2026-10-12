/**
 * Handlers `spaces.*` : liste, document, `applyBatch` atomique, renommage,
 * duplication, suppression, « Ajouter à un space › », assets (Finder, presse-papiers), promotion
 * d'un asset en élément de la bibliothèque, presse-papiers interne, export PNG (fenêtre stage).
 */
import { AppError } from '../../../shared/errors'
import { ItemStyle } from '../../../shared/spaces-schema'
import { emitEvent } from '../../events'
import { ingest } from '../../ingest/ingest'
import { requireJobServices } from '../../jobs/runtime'
import { requireLibrary } from '../../library/library-context'
import { importAssetBuffer, importAssetFiles, type AssetDeps } from '../../spaces/assets'
import { readSpacesClipboard, writeSpacesClipboard } from '../../spaces/clipboard'
import { cancelExport, exportSpacePng, revealLastExport } from '../../spaces/export'
import {
  addItems,
  applyBatch,
  createSpace,
  deleteSpace,
  duplicateSpace,
  getSpace,
  listSpaces,
  renameSpace,
} from '../../spaces/repo'
import type { DomainHandlers } from '../router'
import { ingestDeps } from './ingest'
import { mt } from '../../i18n'

const changed = (uuids: string[]) => emitEvent('spaces.changed', { uuids })

function assetDeps(): AssetDeps {
  const s = requireJobServices()
  return {
    lib: s.lib,
    media: s.media,
    hasTool: (n) => s.hasTool(n),
    log: (m, err) => s.log.warn(m, err),
  }
}

export const spacesHandlers: DomainHandlers<'spaces'> = {
  'spaces.list': () => listSpaces(requireLibrary()),

  'spaces.create': ({ name }) => {
    const r = createSpace(requireLibrary(), name)
    changed([r.uuid])
    return r
  },

  'spaces.get': ({ uuid }) => getSpace(requireLibrary(), uuid),

  'spaces.applyBatch': (input) => {
    const r = applyBatch(requireLibrary(), input)
    changed([input.spaceUuid])
    return r
  },

  'spaces.rename': ({ uuid, name }) => {
    renameSpace(requireLibrary(), uuid, name)
    changed([uuid])
  },

  'spaces.duplicate': ({ uuid }) => {
    const r = duplicateSpace(requireLibrary(), uuid)
    changed([r.uuid])
    return r
  },

  'spaces.delete': ({ uuid }) => {
    deleteSpace(requireLibrary(), uuid)
    changed([uuid])
  },

  'spaces.addItems': ({ spaceUuid, itemUuids }) => {
    const r = addItems(requireLibrary(), spaceUuid, itemUuids)
    changed([spaceUuid])
    return { added: r.added }
  },

  'spaces.addAssets': async ({ spaceUuid, paths }) => {
    requireLibrary()
    const { assets, failed } = await importAssetFiles(assetDeps(), paths)
    if (assets.length === 0 && failed.length > 0) {
      throw new AppError('unsupported', failed[0]!.message)
    }
    if (failed.length > 0) {
      requireJobServices().log.warn(
        `[spaces] ${failed.length} fichier(s) ignoré(s) pour ${spaceUuid}`,
        failed,
      )
    }
    return assets
  },

  'spaces.addAssetBuffer': async ({ bytes }) => importAssetBuffer(assetDeps(), bytes),

  'spaces.promoteAsset': async ({ spaceUuid, nodeUuid }) => {
    const lib = requireLibrary()
    const space = lib.repos.spaces.getByUuid(spaceUuid)
    if (!space) throw new AppError('not_found', mt().errors.spaceNotFound)
    const node = lib.db
      .prepare('SELECT * FROM space_nodes WHERE uuid = ? AND space_id = ?')
      .get(nodeUuid, space.id) as
      { id: number; type: string; asset_rel: string | null; style: string } | undefined
    if (!node || node.type !== 'image' || !node.asset_rel) {
      throw new AppError('not_found', mt().errors.spaceImageNotFound)
    }
    const r = await ingest({ type: 'file', path: lib.paths.abs(node.asset_rel) }, {}, ingestDeps())
    const item = lib.repos.items.getByUuid(r.itemUuid)
    if (!item) throw new AppError('not_found', mt().errors.itemNotFoundAfterAdd)
    const old = JSON.parse(node.style) as Record<string, unknown>
    const style = ItemStyle.parse({
      fit: old.fit ?? 'cover',
      radius: old.radius ?? 8,
      border: old.border ?? false,
      lockAspect: old.lockAspect ?? true,
      ...(typeof old.opacity === 'number' ? { opacity: old.opacity } : {}),
    })
    // L'asset devient orphelin : collecté au prochain démarrage (l'annulation reste possible).
    lib.db
      .prepare(
        `UPDATE space_nodes SET type = 'item', item_id = ?, asset_rel = NULL, style = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(item.id, JSON.stringify(style), Date.now(), node.id)
    changed([spaceUuid])
    return { itemUuid: r.itemUuid }
  },

  'spaces.clipboardWrite': async (a) => {
    await writeSpacesClipboard(a)
  },

  'spaces.readClipboard': () => readSpacesClipboard(),

  'spaces.exportPng': (input, ctx) => exportSpacePng(input, ctx),

  'spaces.exportCancel': () => {
    cancelExport()
  },

  'spaces.revealExport': () => {
    revealLastExport()
  },
}
