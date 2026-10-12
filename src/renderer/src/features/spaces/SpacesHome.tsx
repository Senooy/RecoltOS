/**
 * Liste des spaces (route `spaces`). État vide :
 * `ChartPie` 32 px `--fg-faint`, 14 px, « Aucun space pour l'instant » 17/22 500, 8 px, texte 13/18
 * `--fg-subtle` (360 px max), 20 px, pilule noire 36 px « Créer ton premier space » ; aucun FAB.
 * Liste : cartes de 240 px, « Nouveau space » en tirets d'abord, puis `SpaceCard` (vignette 16:10 =
 * rendu DOM réduit des 20 premiers nœuds, nom 14/600, « Modifié avant-hier »), triées par
 * modification. Menu « … » / clic droit : Renommer, Dupliquer, Supprimer (confirmation).
 */
import { ChartPie, Copy, Ellipsis, Pencil, Plus, Trash } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SpaceSummary } from '../../../../shared/dto/spaces'
import { aabb, unionRect } from '../../../../shared/spaces-geometry'
import { Menu } from '../../components/ui'
import { fr } from '../../i18n/fr'
import { relative } from '../../lib/format'
import { rpc, subscribe } from '../../lib/rpc'
import { askName } from '../../state/dialogs'
import { useUi } from '../../state/ui'
import { NodeContent } from './editor/nodes/NodeContent'
import { deleteSpaceWithConfirm, duplicateSpace, newSpace, renameSpace } from './space-actions'
import './spaces.css'

const CARD_W = 240
const THUMB_H = 150
const PAD = 16

/** Vignette : rendu DOM réduit des nœuds d'aperçu, inerte. */
export function SpaceThumb({ preview }: { preview: SpaceSummary['preview'] }) {
  const box = useMemo(() => unionRect(preview.nodes.map(aabb)), [preview.nodes])
  if (!box || preview.nodes.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-fg-disabled">
        <ChartPie size={22} strokeWidth={1.5} />
      </div>
    )
  }
  const s = Math.min((CARD_W - 2 * PAD) / box.width, (THUMB_H - 2 * PAD) / box.height, 1)
  const ox = (CARD_W - box.width * s) / 2 - box.x * s
  const oy = (THUMB_H - box.height * s) / 2 - box.y * s
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  return (
    <div className="sp-thumb h-full w-full" aria-hidden="true">
      <div className="space-world" style={{ transform: `translate(${ox}px, ${oy}px) scale(${s})` }}>
        {[...preview.nodes]
          .sort((a, b) => a.z - b.z)
          .map((n) => (
            <div
              key={n.uuid}
              className="space-node"
              data-type={n.type}
              style={{
                width: n.width,
                height: n.height,
                transform: `translate(${n.x}px, ${n.y}px) rotate(${n.rotation}deg)`,
                zIndex: n.z,
              }}
            >
              <div className="node-content">
                <NodeContent
                  node={n}
                  card={n.type === 'item' && n.itemUuid ? preview.items[n.itemUuid] : undefined}
                  editing={false}
                  screenScale={s * dpr}
                  videoActive={false}
                />
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}

function CardMenuItems({
  space,
  Item,
}: {
  space: SpaceSummary
  Item: typeof Menu.Dropdown.Item | typeof Menu.Context.Item
}) {
  const rename = async () => {
    const name = await askName({
      title: fr.spacesUi.renameTitle,
      initial: space.name,
      confirmLabel: fr.spaces.rename,
    })
    if (name) await renameSpace(space.uuid, name)
  }
  return (
    <>
      <Item icon={<Pencil />} onSelect={() => void rename()}>
        {fr.spaces.rename}
      </Item>
      <Item icon={<Copy />} onSelect={() => void duplicateSpace(space.uuid, space.name)}>
        {fr.spaces.duplicate}
      </Item>
      <Item
        tone="danger"
        icon={<Trash />}
        data-testid="space-card-delete"
        onSelect={() => void deleteSpaceWithConfirm(space.uuid, space.name)}
      >
        {fr.spaces.delete}
      </Item>
    </>
  )
}

function SpaceCard({ space }: { space: SpaceSummary }) {
  const navigate = useUi((s) => s.navigate)
  const open = () => navigate({ name: 'space', uuid: space.uuid })
  return (
    <Menu.Context.Root>
      <Menu.Context.Trigger asChild>
        <div
          role="listitem"
          data-testid="space-card"
          data-uuid={space.uuid}
          className="group relative w-[240px] cursor-pointer"
          onClick={open}
          onKeyDown={(e) => {
            if (e.key === 'Enter') open()
          }}
          tabIndex={0}
        >
          <div
            className="overflow-hidden rounded-[10px] border border-border bg-bg transition-shadow group-hover:shadow-[var(--shadow-card-hover)]"
            style={{ width: CARD_W, height: THUMB_H }}
          >
            <SpaceThumb preview={space.preview} />
          </div>
          <div className="mt-2.5 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div
                className="truncate text-[14px] font-semibold leading-5 text-fg"
                data-testid="space-card-name"
              >
                {space.name || fr.spaces.untitled}
              </div>
              <div className="text-[12px] leading-4 text-fg-faint">
                {fr.spaces.edited(relative(space.updatedAt))}
                {space.nodeCount > 0 ? ` · ${fr.spacesUi.nodes(space.nodeCount)}` : ''}
              </div>
            </div>
            <Menu.Dropdown.Root>
              <Menu.Dropdown.Trigger asChild>
                <button
                  type="button"
                  aria-label={fr.spacesUi.moreActions}
                  data-testid="space-card-more"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-subtle opacity-0 transition-opacity hover:bg-[var(--hover)] group-hover:opacity-100 data-[state=open]:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Ellipsis size={16} strokeWidth={1.75} />
                </button>
              </Menu.Dropdown.Trigger>
              <Menu.Dropdown.Content align="end" onClick={(e) => e.stopPropagation()}>
                <CardMenuItems space={space} Item={Menu.Dropdown.Item} />
              </Menu.Dropdown.Content>
            </Menu.Dropdown.Root>
          </div>
        </div>
      </Menu.Context.Trigger>
      <Menu.Context.Content onClick={(e) => e.stopPropagation()}>
        <CardMenuItems space={space} Item={Menu.Context.Item} />
      </Menu.Context.Content>
    </Menu.Context.Root>
  )
}

function NewSpaceCard() {
  return (
    <button
      type="button"
      data-testid="space-new-card"
      className="flex w-[240px] flex-col items-start"
      onClick={() => void newSpace()}
    >
      <span
        className="flex items-center justify-center rounded-[10px] border border-dashed border-[var(--border-dashed)] text-fg-faint transition-colors hover:bg-[var(--hover)] hover:text-fg-muted"
        style={{ width: CARD_W, height: THUMB_H }}
      >
        <Plus size={20} strokeWidth={1.5} />
      </span>
      <span className="mt-2.5 text-[14px] font-semibold leading-5 text-fg-muted">
        {fr.spacesUi.newCard}
      </span>
    </button>
  )
}

function Empty() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center" data-testid="spaces-empty">
      <ChartPie size={32} strokeWidth={1.5} className="text-fg-faint" aria-hidden="true" />
      <h2 className="mt-3.5 text-[17px] font-medium leading-[22px] text-fg">
        {fr.spaces.emptyTitle}
      </h2>
      <p className="mt-2 max-w-[360px] text-center text-[13px] leading-[18px] text-fg-subtle">
        {fr.spaces.emptyBody}
      </p>
      <button
        type="button"
        data-testid="space-empty-cta"
        className="mt-5 h-9 rounded-full bg-accent px-4 text-[13px] font-medium text-accent-fg transition-opacity hover:opacity-90"
        onClick={() => void newSpace()}
      >
        {fr.spaces.createFirst}
      </button>
    </div>
  )
}

export default function SpacesHome() {
  const [spaces, setSpaces] = useState<SpaceSummary[] | null>(null)
  const load = useCallback(() => {
    void rpc('spaces.list')
      .then(setSpaces)
      .catch(() => setSpaces([]))
  }, [])
  useEffect(() => {
    load()
    let t: ReturnType<typeof setTimeout> | null = null
    const off = subscribe('spaces.changed', () => {
      if (t) clearTimeout(t)
      t = setTimeout(load, 120)
    })
    const offItems = subscribe('items.changed', () => {
      if (t) clearTimeout(t)
      t = setTimeout(load, 400)
    })
    return () => {
      off()
      offItems()
      if (t) clearTimeout(t)
    }
  }, [load])
  if (spaces === null) return null
  if (spaces.length === 0) return <Empty />
  return (
    <main
      data-testid="spaces-list"
      aria-label={fr.spacesUi.listLabel}
      className="relative min-h-0 flex-1 overflow-y-auto"
    >
      <div role="list" className="flex flex-wrap gap-x-5 gap-y-7 px-8 pb-16 pt-6">
        <NewSpaceCard />
        {spaces.map((s) => (
          <SpaceCard key={s.uuid} space={s} />
        ))}
      </div>
    </main>
  )
}
