/**
 * `NavSegmented` (DESIGN §2.4) : 480×52 centré (centre y=55), loupe Ø42 puis Bibliothèque /
 * Collections / Spaces (140×42), pilule active animée (`layoutId`), icône 18 px sur le segment actif
 * seulement. Variante `dark` (étagère).
 */
import { ChartPie, Folder, Library, Search } from 'lucide-react'
import { LayoutGroup, motion } from 'motion/react'
import { fr } from '../i18n/fr'
import { cn } from '../lib/cn'

export type NavValue = 'search' | 'library' | 'collections' | 'spaces'

const SEGMENTS = [
  { value: 'library', label: fr.nav.library, Icon: Library },
  { value: 'collections', label: fr.nav.collections, Icon: Folder },
  { value: 'spaces', label: fr.nav.spaces, Icon: ChartPie },
] as const

const SPRING = { type: 'spring', stiffness: 520, damping: 42, mass: 0.8 } as const

export function NavSegmented({
  value,
  onChange,
  tone = 'light',
}: {
  value: NavValue
  onChange: (v: NavValue) => void
  tone?: 'light' | 'dark'
}) {
  const dark = tone === 'dark'
  const pill = dark ? 'bg-[#f2f2f2]' : 'bg-accent'
  return (
    <LayoutGroup id="nav">
      <nav
        data-testid="nav-segmented"
        aria-label={fr.nav.library}
        className={cn(
          'app-no-drag absolute left-1/2 top-[29px] flex h-[52px] w-[480px] -translate-x-1/2 items-center gap-[2px] rounded-full border p-[5px]',
          dark ? 'border-[#2a2a2c] bg-[#161618]' : 'border-border bg-bg',
        )}
        style={{ boxShadow: 'var(--shadow-pill)' }}
      >
        <button
          type="button"
          data-testid="seg-search"
          aria-label={fr.nav.search}
          aria-current={value === 'search' ? 'page' : undefined}
          className="relative flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full"
          onClick={() => onChange('search')}
        >
          {value === 'search' ? (
            <motion.span
              layoutId="nav-pill"
              transition={SPRING}
              className={cn('absolute inset-0 rounded-full', pill)}
            />
          ) : null}
          <Search
            size={20}
            strokeWidth={1.75}
            className={cn(
              'relative',
              value === 'search'
                ? dark
                  ? 'text-[#0a0a0a]'
                  : 'text-accent-fg'
                : dark
                  ? 'text-white'
                  : 'text-fg',
            )}
          />
        </button>
        {SEGMENTS.map(({ value: v, label, Icon }) => {
          const active = value === v
          return (
            <button
              key={v}
              type="button"
              data-testid={`seg-${v}`}
              aria-current={active ? 'page' : undefined}
              className="relative flex h-[42px] w-[140px] shrink-0 items-center justify-center rounded-full text-nav font-medium tracking-[-0.01em]"
              onClick={() => onChange(v)}
            >
              {active ? (
                <motion.span
                  layoutId="nav-pill"
                  transition={SPRING}
                  className={cn('absolute inset-0 rounded-full', pill)}
                />
              ) : null}
              <span
                className={cn(
                  'relative flex items-center gap-2',
                  active
                    ? dark
                      ? 'text-[#0a0a0a]'
                      : 'text-accent-fg'
                    : dark
                      ? 'text-white'
                      : 'text-fg',
                )}
              >
                {active ? <Icon size={18} strokeWidth={1.75} /> : null}
                {label}
              </span>
            </button>
          )
        })}
      </nav>
    </LayoutGroup>
  )
}
