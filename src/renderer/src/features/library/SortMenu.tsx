/**
 * Menu de tri (DESIGN §3.1) : déclencheur 32 px (rayon 10, bordure), options avec coche.
 */
import { Check, ChevronDown, Clock } from 'lucide-react'
import type { SortMode } from '../../../../shared/enums'
import { Menu } from '../../components/ui'
import { fr } from '../../i18n/fr'

const OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'recent', label: fr.sort.recent },
  { value: 'oldest', label: fr.sort.oldest },
  { value: 'viewed', label: fr.sort.recentlyViewed },
  { value: 'mostViewed', label: fr.sort.mostViewed },
  { value: 'name', label: fr.sort.name },
  { value: 'color', label: fr.sort.color },
  { value: 'random', label: fr.sort.random },
]

export function SortMenu({
  value,
  onChange,
}: {
  value: SortMode
  onChange: (v: SortMode) => void
}) {
  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0]!
  return (
    <Menu.Dropdown.Root>
      <Menu.Dropdown.Trigger asChild>
        <button
          type="button"
          data-testid="sort-menu"
          aria-label={fr.libraryUi.sortLabel}
          className="flex h-8 min-w-[138px] items-center gap-2 whitespace-nowrap rounded-[10px] border border-border pl-3 pr-2.5 text-ui font-medium text-fg hover:bg-[var(--hover)]"
        >
          <Clock size={15} strokeWidth={1.75} />
          <span>{current.label}</span>
          <ChevronDown size={14} className="ml-auto text-fg-subtle" />
        </button>
      </Menu.Dropdown.Trigger>
      <Menu.Dropdown.Content align="end" className="w-[220px]">
        {OPTIONS.map((o) => (
          <Menu.Dropdown.Item key={o.value} onSelect={() => onChange(o.value)}>
            <span className="flex w-full items-center">
              <span className="flex-1">{o.label}</span>
              {o.value === value ? <Check size={15} className="text-fg" /> : null}
            </span>
          </Menu.Dropdown.Item>
        ))}
      </Menu.Dropdown.Content>
    </Menu.Dropdown.Root>
  )
}
