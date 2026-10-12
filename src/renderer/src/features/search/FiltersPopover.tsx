/**
 * `FiltersPopover` : Radix Popover `align="end"`, 320 px, rayon 12, padding 14.
 * Type, Source, Couleur (12 pastilles + personnalisée), Période, Collection, Tags ; « Réinitialiser ».
 * Les filtres s'appliquent en direct.
 */
import { Check } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { TagInfo } from '../../../../shared/dto/collections'
import type { ItemKind, Source } from '../../../../shared/enums'
import { Button, Popover, SegmentedSmall, Slider, Tooltip } from '../../components/ui'
import { fr } from '../../i18n/fr'
import { cn } from '../../lib/cn'
import { flattenTree, useCollections } from '../../state/collections'
import { EMPTY_FILTERS, SWATCHES, toggle, type Period, type SearchFilters } from './filters'

const KINDS: ItemKind[] = ['image', 'video', 'tweet', 'url']
const SOURCES: Source[] = ['x', 'instagram', 'cosmos', 'web', 'capture', 'local']

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <div className="mb-1.5 text-micro font-medium uppercase text-fg-faint">{label}</div>
      {children}
    </div>
  )
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cn(
        'h-7 rounded-full border px-3 text-[12.5px] transition-colors',
        on
          ? 'border-accent bg-accent text-accent-fg'
          : 'border-border text-fg-muted hover:bg-[var(--hover)]',
      )}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export function FiltersPopover({
  value,
  onChange,
  tags,
  noPalette,
  children,
}: {
  value: SearchFilters
  onChange: (f: SearchFilters) => void
  tags: readonly TagInfo[]
  noPalette: number
  children: ReactNode
}) {
  const tree = useCollections((s) => s.tree)
  const flat = useMemo(() => flattenTree(tree), [tree])
  const [tagText, setTagText] = useState('')
  const tagMatches = tagText.trim()
    ? tags
        .filter(
          (t) =>
            t.name.toLowerCase().includes(tagText.trim().toLowerCase()) &&
            !value.tags.some((x) => x.uuid === t.uuid),
        )
        .slice(0, 6)
    : []
  const set = (patch: Partial<SearchFilters>) => onChange({ ...value, ...patch })
  /** Dernière couleur libre (hors pastilles nommées). */
  const custom = [...value.colors].reverse().find((h) => !SWATCHES.some((c) => c.hex === h))
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Content
        align="end"
        data-testid="filters-popover"
        className="w-[320px] p-[14px]"
        aria-label={fr.search.filters}
      >
        <Group label={fr.search.type}>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <Toggle
                key={k}
                on={value.kinds.includes(k)}
                label={fr.searchUi.kinds[k]!}
                onClick={() => set({ kinds: toggle(value.kinds, k) })}
              />
            ))}
          </div>
        </Group>
        <Group label={fr.search.source}>
          <div className="flex flex-wrap gap-1.5">
            {SOURCES.map((s) => (
              <Toggle
                key={s}
                on={value.sources.includes(s)}
                label={fr.searchUi.sources[s]!}
                onClick={() => set({ sources: toggle(value.sources, s) })}
              />
            ))}
          </div>
        </Group>
        <Group label={fr.search.color}>
          <div className="flex flex-wrap items-center gap-[7px]" data-testid="color-filter">
            {SWATCHES.map((c) => {
              const on = value.colors.includes(c.hex)
              return (
                <Tooltip key={c.id} content={c.label} side="top">
                  <button
                    type="button"
                    data-color={c.id}
                    aria-label={fr.searchUi.colorChip(c.label)}
                    aria-pressed={on}
                    className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-[rgba(128,128,128,.35)]"
                    style={{ background: c.hex }}
                    onClick={() => set({ colors: toggle(value.colors, c.hex) })}
                  >
                    {on ? (
                      <Check
                        size={12}
                        strokeWidth={2.5}
                        className={c.lab[0] > 70 ? 'text-black' : 'text-white'}
                      />
                    ) : null}
                  </button>
                </Tooltip>
              )
            })}
            <label className="ml-1 flex h-[22px] cursor-default items-center gap-1.5 text-[12px] text-fg-muted">
              <input
                type="color"
                className="h-[22px] w-[22px] cursor-default rounded-full border-0 bg-transparent p-0"
                value={custom ?? '#888888'}
                onChange={(e) => {
                  const hex = e.target.value.toLowerCase()
                  const rest = value.colors.filter((h) => h !== custom)
                  set({ colors: [...rest, hex].slice(-5) })
                }}
              />
              {fr.search.custom}
            </label>
          </div>
          {value.colors.length > 0 ? (
            <div className="mt-2 flex items-center gap-3">
              <span className="text-[12px] text-fg-muted">{fr.colorUi.tolerance}</span>
              <Slider
                variant="settings"
                label={fr.colorUi.tolerance}
                min={6}
                max={40}
                step={1}
                value={value.tolerance}
                valueText={String(value.tolerance)}
                onValueChange={(tolerance) => set({ tolerance })}
                className="w-[150px]"
              />
              <span className="text-[11.5px] tabular-nums text-fg-faint">{value.tolerance}</span>
            </div>
          ) : null}
          {value.colors.length > 0 && noPalette > 0 ? (
            <p className="mt-1.5 text-[11px] text-fg-faint" data-testid="no-palette">
              {fr.search.noPalette(noPalette)}
            </p>
          ) : null}
        </Group>
        <Group label={fr.search.period}>
          <SegmentedSmall<Period>
            label={fr.search.period}
            value={value.period}
            onChange={(period) => set({ period })}
            options={[
              { value: 'all', label: fr.search.anytime },
              { value: '7d', label: fr.search.d7 },
              { value: '30d', label: fr.search.d30 },
              { value: '1y', label: fr.search.y1 },
            ]}
          />
        </Group>
        <Group label={fr.search.inCollection}>
          <select
            aria-label={fr.search.inCollection}
            className="h-8 w-full rounded-[10px] border border-border bg-bg px-2.5 text-small"
            value={value.collectionUuid ?? ''}
            onChange={(e) => set({ collectionUuid: e.target.value || null })}
          >
            <option value="">{fr.searchUi.anyCollection}</option>
            {flat.map(({ node, depth }) => (
              <option key={node.uuid} value={node.uuid}>
                {`${'  '.repeat(depth)}${node.name}`}
              </option>
            ))}
          </select>
        </Group>
        <Group label={fr.search.tags}>
          <input
            className="h-8 w-full rounded-[10px] border border-border bg-bg px-2.5 text-small outline-none focus:border-border-strong"
            placeholder={fr.searchUi.tagsPlaceholder}
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tagMatches[0]) {
                set({ tags: [...value.tags, tagMatches[0]] })
                setTagText('')
              }
            }}
          />
          {tagMatches.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {tagMatches.map((t) => (
                <button
                  key={t.uuid}
                  type="button"
                  className="h-6 rounded-full border border-border px-2.5 text-[12px] text-fg-muted hover:bg-[var(--hover)]"
                  onClick={() => {
                    set({ tags: [...value.tags, { uuid: t.uuid, name: t.name }] })
                    setTagText('')
                  }}
                >
                  #{t.name}
                </button>
              ))}
            </div>
          ) : null}
        </Group>
        <div className="mt-3.5 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
            {fr.search.reset}
          </Button>
        </div>
      </Popover.Content>
    </Popover.Root>
  )
}
