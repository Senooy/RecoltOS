/**
 * `CollectionPickerPopover` (reusable: Rediscover, Details panel, moving a collection):
 * « Filtrer… » field, flat list with sub-collections indented by 12 px, optional « racine » option.
 */
import { Check, CornerDownRight, Folder, FolderPlus } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { CollectionNode } from '../../../../shared/dto/collections'
import { Popover } from '../../components/ui'
import { tr } from '../../i18n'
import { cn } from '../../lib/cn'
import { flattenTree, useCollections } from '../../state/collections'

export interface CollectionPickerProps {
  children: ReactNode
  onPick: (node: CollectionNode | null) => void
  /** Offers « Aucune (racine) » at the top. */
  allowRoot?: boolean
  /** Checked collections (membership). */
  checked?: readonly string[]
  /** Uuid excluded from the list (the collection itself). */
  exclude?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
  /** Collections suggested at the top (Rediscover: the 3 most recently used). */
  suggested?: readonly { uuid: string; name: string }[]
  /** « Nouvelle collection… » last. */
  onCreate?: () => void
  side?: 'top' | 'bottom'
}

export function CollectionPickerPopover({
  children,
  onPick,
  allowRoot = false,
  checked = [],
  exclude,
  open,
  onOpenChange,
  align = 'start',
  suggested = [],
  onCreate,
  side = 'bottom',
}: CollectionPickerProps) {
  const tree = useCollections((s) => s.tree)
  const [filter, setFilter] = useState('')
  const flat = useMemo(
    () => flattenTree(tree).filter((f) => f.node.uuid !== exclude),
    [tree, exclude],
  )
  const q = filter.trim().toLowerCase()
  const shown = q ? flat.filter((f) => f.node.name.toLowerCase().includes(q)) : flat
  const rootProps = open === undefined ? {} : { open }
  return (
    <Popover.Root
      {...rootProps}
      onOpenChange={(o) => {
        if (!o) setFilter('')
        onOpenChange?.(o)
      }}
    >
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Content
        align={align}
        side={side}
        data-testid="collection-picker"
        aria-label={tr.collectionUi.pickerLabel}
        className="w-[260px] p-[5px]"
      >
        <input
          autoFocus
          data-testid="collection-picker-filter"
          className="mb-1 h-8 w-full rounded-sm border border-border bg-bg px-2.5 text-small outline-none focus:border-border-strong"
          placeholder={tr.collectionUi.pickerFilter}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="max-h-[300px] overflow-y-auto" role="listbox">
          {!q && suggested.length > 0 ? (
            <>
              <div className="px-2 pb-1 pt-1.5 text-micro font-medium uppercase text-fg-faint">
                {tr.rediscoverUi.suggested}
              </div>
              {suggested.map((c) => {
                const node = flat.find((f) => f.node.uuid === c.uuid)?.node
                if (!node) return null
                return (
                  <PickerRow
                    key={`s-${c.uuid}`}
                    icon={<Folder size={15} strokeWidth={1.75} />}
                    label={c.name}
                    depth={0}
                    onClick={() => {
                      onPick(node)
                      onOpenChange?.(false)
                    }}
                  />
                )
              })}
              <div className="px-2 pb-1 pt-2 text-micro font-medium uppercase text-fg-faint">
                {tr.rediscoverUi.all}
              </div>
            </>
          ) : null}
          {allowRoot && !q ? (
            <PickerRow
              icon={<CornerDownRight size={15} strokeWidth={1.75} />}
              label={tr.collectionUi.moveToRoot}
              depth={0}
              onClick={() => {
                onPick(null)
                onOpenChange?.(false)
              }}
            />
          ) : null}
          {shown.map(({ node, depth }) => (
            <PickerRow
              key={node.uuid}
              icon={<Folder size={15} strokeWidth={1.75} />}
              label={node.name}
              depth={q ? 0 : depth}
              checked={checked.includes(node.uuid)}
              onClick={() => {
                onPick(node)
                onOpenChange?.(false)
              }}
            />
          ))}
          {shown.length === 0 && !(allowRoot && !q) ? (
            <div className="px-2 py-2 text-small text-fg-faint">{tr.collectionUi.pickerEmpty}</div>
          ) : null}
          {onCreate ? (
            <PickerRow
              icon={<FolderPlus size={15} strokeWidth={1.75} />}
              label={tr.rediscoverUi.newCollection}
              depth={0}
              onClick={() => {
                onOpenChange?.(false)
                onCreate()
              }}
            />
          ) : null}
        </div>
      </Popover.Content>
    </Popover.Root>
  )
}

function PickerRow({
  icon,
  label,
  depth,
  checked = false,
  onClick,
}: {
  icon: ReactNode
  label: string
  depth: number
  checked?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={checked}
      data-testid="collection-picker-item"
      className={cn(
        'flex h-7 w-full items-center gap-2.5 rounded-sm pr-2 text-left text-[13.5px] text-fg hover:bg-[var(--hover)] [&_svg]:text-fg-subtle',
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checked ? <Check size={15} strokeWidth={2} className="text-fg" /> : null}
    </button>
  )
}
