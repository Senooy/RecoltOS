/**
 * `NavSegmented` : 480×52 centré (centre y=55), loupe Ø42 puis Bibliothèque /
 * Collections / Spaces (140×42), pilule active animée (`layoutId`), icône 18 px sur le segment actif
 * seulement. Variante `dark` (étagère).
 */
import { ChartPie, Folder, Library, Search } from 'lucide-react'
import { LayoutGroup, motion } from 'motion/react'
import { tr } from '../i18n'
import { cn } from '../lib/cn'

export type NavValue = 'search' | 'library' | 'collections' | 'spaces'

/** Libellés lus au rendu : ils suivent la langue active. */
const segments = () =>
  [
    { value: 'library', label: tr.nav.library, Icon: Library },
    { value: 'collections', label: tr.nav.collections, Icon: Folder },
    { value: 'spaces', label: tr.nav.spaces, Icon: ChartPie },
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
  const pill = dark ? 'bg-[var(--shelf-seg-pill)]' : 'bg-[var(--seg-pill)]'
  return (
    <LayoutGroup id="nav">
      <nav
        data-testid="nav-segmented"
        aria-label={tr.nav.library}
        className={cn(
          'app-no-drag absolute left-1/2 top-[29px] flex h-[52px] w-[480px] -translate-x-1/2 items-center gap-[2px] rounded-full border p-[5px]',
          dark
            ? 'border-[var(--shelf-seg-border)] bg-[var(--shelf-seg-bg)]'
            : 'border-[var(--seg-border)] bg-[var(--seg-bg)]',
        )}
        style={{ boxShadow: 'var(--shadow-pill)' }}
      >
        <button
          type="button"
          data-testid="seg-search"
          aria-label={tr.nav.search}
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
                  ? 'text-[var(--shelf-seg-pill-fg)]'
                  : 'text-[var(--seg-pill-fg)]'
                : dark
                  ? 'text-[var(--shelf-seg-fg)]'
                  : 'text-[var(--seg-fg)]',
            )}
          />
        </button>
        {segments().map(({ value: v, label, Icon }) => {
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
                      ? 'text-[var(--shelf-seg-pill-fg)]'
                      : 'text-[var(--seg-pill-fg)]'
                    : dark
                      ? 'text-[var(--shelf-seg-fg)]'
                      : 'text-[var(--seg-fg)]',
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
