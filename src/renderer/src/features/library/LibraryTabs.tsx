/**
 * Library tabs: icon + label WITHOUT count; the active tab carries its icon and an
 * animated 2 px underline (`layoutId`).
 */
import { EyeOff, Folder, Images, Inbox, Trash } from 'lucide-react'
import { LayoutGroup, motion } from 'motion/react'
import type { LibraryTab } from '../../../../shared/enums'
import { tr } from '../../i18n'
import { cn } from '../../lib/cn'

/** Labels read at render time: they follow the active language. */
const tabs = () =>
  [
    { key: 'all', label: tr.tabs.all, Icon: Images },
    { key: 'saved', label: tr.tabs.saved, Icon: Folder },
    { key: 'unsorted', label: tr.tabs.unsorted, Icon: Inbox },
    { key: 'trash', label: tr.tabs.trash, Icon: Trash },
    { key: 'hidden', label: tr.tabs.hidden, Icon: EyeOff },
  ] as const

export function LibraryTabs({
  value,
  onChange,
}: {
  value: LibraryTab
  onChange: (t: LibraryTab) => void
}) {
  return (
    <LayoutGroup id="lib-tabs">
      <div
        role="tablist"
        aria-label={tr.libraryUi.tabsLabel}
        className="flex h-full items-center gap-11 pl-[6px] pt-[6px]"
      >
        {tabs().map(({ key, label, Icon }) => {
          const active = value === key
          return (
            <button
              key={key}
              role="tab"
              type="button"
              data-testid={`tab-${key}`}
              aria-selected={active}
              className={cn(
                'relative flex h-full items-center gap-1.5 text-tab font-medium transition-colors',
                active ? 'text-fg' : 'text-fg-subtle hover:text-fg',
              )}
              onClick={() => onChange(key)}
            >
              {active ? <Icon size={18} strokeWidth={1.75} /> : null}
              {label}
              {active ? (
                <motion.span
                  layoutId="lib-tab-underline"
                  className="absolute inset-x-0 -bottom-px h-0.5 rounded-[1px] bg-accent"
                  transition={{ type: 'spring', stiffness: 520, damping: 42 }}
                />
              ) : null}
            </button>
          )
        })}
      </div>
    </LayoutGroup>
  )
}
