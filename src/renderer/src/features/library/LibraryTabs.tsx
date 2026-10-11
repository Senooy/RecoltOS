/**
 * Onglets de la Bibliothèque (DESIGN §3.1, ERRATA §C) : icône + libellé SANS nombre ; l'onglet
 * actif porte son icône et un soulignement de 2 px animé (`layoutId`).
 */
import { EyeOff, Folder, Images, Inbox, Trash } from 'lucide-react'
import { LayoutGroup, motion } from 'motion/react'
import type { LibraryTab } from '../../../../shared/enums'
import { fr } from '../../i18n/fr'
import { cn } from '../../lib/cn'

const TABS = [
  { key: 'all', label: fr.tabs.all, Icon: Images },
  { key: 'saved', label: fr.tabs.saved, Icon: Folder },
  { key: 'unsorted', label: fr.tabs.unsorted, Icon: Inbox },
  { key: 'trash', label: fr.tabs.trash, Icon: Trash },
  { key: 'hidden', label: fr.tabs.hidden, Icon: EyeOff },
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
        aria-label={fr.libraryUi.tabsLabel}
        className="flex h-full items-center gap-11 pl-[6px]"
      >
        {TABS.map(({ key, label, Icon }) => {
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
