/**
 * Coque statique sur les tokens : en-tête 96 px, sous-barre 60 px, rangée de
 * collections et grille squelette. Remplacée par `AppShell`.
 */
import {
  ChevronDown,
  ChevronsUpDown,
  Clock,
  Compass,
  EyeOff,
  Folder,
  Grid2x2,
  Images,
  Inbox,
  Library,
  Moon,
  Plus,
  Search,
  Settings,
  Square,
  Sun,
  Trash,
} from 'lucide-react'
import { fr } from '../i18n/fr'

const COLUMNS = 4
/** Hauteurs relatives des cartes squelette (1,2 / 0,8 / 1,5…). */
const SKELETON_RATIOS = [1.2, 0.8, 1.5, 1, 0.75, 1.3, 0.9, 1.25, 1.4, 0.7, 1.1, 0.85]

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="7" fill="var(--fg)" />
      <g stroke="var(--bg)" strokeWidth="1.8" strokeLinecap="round" fill="none">
        <path d="M14 21V8" />
        <path d="M14 12.5c-2.2-.4-3.6-1.8-4-4 2.2.3 3.6 1.7 4 4Z" />
        <path d="M14 12.5c2.2-.4 3.6-1.8 4-4-2.2.3-3.6 1.7-4 4Z" />
        <path d="M14 17c-2.2-.4-3.6-1.8-4-4 2.2.3 3.6 1.7 4 4Z" />
        <path d="M14 17c2.2-.4 3.6-1.8 4-4-2.2.3-3.6 1.7-4 4Z" />
      </g>
    </svg>
  )
}

function NavSegmentedStatic() {
  const seg =
    'flex h-[42px] w-[140px] items-center justify-center gap-2 rounded-full text-nav font-medium tracking-[-0.01em]'
  return (
    <nav
      aria-label={fr.nav.library}
      className="absolute left-1/2 top-[29px] flex h-[52px] w-[480px] -translate-x-1/2 items-center gap-[2px] rounded-full border border-border bg-bg p-[5px]"
      style={{ boxShadow: 'var(--shadow-pill)' }}
    >
      <button
        type="button"
        aria-label={fr.nav.search}
        className="flex h-[42px] w-[42px] items-center justify-center rounded-full text-fg"
      >
        <Search size={20} strokeWidth={1.75} />
      </button>
      <button type="button" aria-current="page" className={`${seg} bg-accent text-accent-fg`}>
        <Library size={18} strokeWidth={1.75} />
        {fr.nav.library}
      </button>
      <button type="button" className={`${seg} text-fg`}>
        {fr.nav.collections}
      </button>
      <button type="button" className={`${seg} text-fg`}>
        {fr.nav.spaces}
      </button>
    </nav>
  )
}

function HeaderActionsStatic({ dark }: { dark: boolean }) {
  const icon = 'flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle'
  return (
    <div className="absolute right-6 top-[41px] flex h-7 items-center gap-2">
      <button
        type="button"
        className="mr-2 flex h-[30px] min-w-[112px] items-center whitespace-nowrap rounded-full border border-border pl-[10px] pr-[5px] text-ui text-fg-subtle"
      >
        <Search size={14} strokeWidth={1.75} />
        <span className="ml-1.5 mr-2">{fr.nav.searchButton}</span>
        <kbd
          className="ml-auto rounded-[5px] px-[5px] py-px text-[11px] leading-[14px]"
          style={{ background: 'var(--kbd-bg)', color: 'var(--kbd-fg)' }}
        >
          ⌘K
        </kbd>
      </button>
      <button type="button" aria-label={fr.nav.rediscover} className={icon}>
        <Compass size={18} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label={dark ? fr.nav.themeLight : fr.nav.themeDark}
        className={icon}
      >
        {dark ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
      </button>
      <button type="button" aria-label={fr.nav.settings} className={icon}>
        <Settings size={18} strokeWidth={1.75} />
      </button>
    </div>
  )
}

function LibraryTabsStatic() {
  const tabs = [
    { key: 'all', label: fr.tabs.all, Icon: Images },
    { key: 'saved', label: fr.tabs.saved, Icon: Folder },
    { key: 'unsorted', label: fr.tabs.unsorted, Icon: Inbox },
    { key: 'trash', label: fr.tabs.trash, Icon: Trash },
    { key: 'hidden', label: fr.tabs.hidden, Icon: EyeOff },
  ] as const
  return (
    <div role="tablist" className="flex h-full items-center gap-11 pl-[6px]">
      {tabs.map(({ key, label, Icon }, i) => (
        <button
          key={key}
          role="tab"
          type="button"
          aria-selected={i === 0}
          className={`relative flex h-full items-center gap-1.5 text-tab font-medium ${i === 0 ? 'text-fg' : 'text-fg-subtle'}`}
        >
          {i === 0 && <Icon size={18} strokeWidth={1.75} />}
          {label}
          {i === 0 && (
            <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-[1px] bg-accent" />
          )}
        </button>
      ))}
    </div>
  )
}

function SubbarRightStatic() {
  return (
    <div className="flex items-center gap-5">
      <div className="flex items-center gap-2 text-fg-disabled" aria-label={fr.columns.label}>
        <Grid2x2 size={12} />
        <div
          className="relative h-[3px] w-[90px] rounded-full"
          style={{ background: 'var(--slider-track)' }}
        >
          <span
            className="absolute top-1/2 h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${((8 - COLUMNS) / 6) * 100}%`, background: 'var(--slider-thumb)' }}
          />
        </div>
        <Square size={11} />
      </div>
      <button
        type="button"
        className="flex h-8 min-w-[138px] items-center gap-2 whitespace-nowrap rounded-[10px] border border-border pl-3 pr-2.5 text-ui font-medium text-fg"
      >
        <Clock size={15} strokeWidth={1.75} />
        <span>{fr.sort.recent}</span>
        <ChevronDown size={14} className="ml-auto text-fg-subtle" />
      </button>
    </div>
  )
}

function GridSkeleton() {
  const columns: number[][] = Array.from({ length: COLUMNS }, () => [])
  SKELETON_RATIOS.forEach((r, i) => columns[i % COLUMNS]?.push(r))
  return (
    <div data-testid="grid-skeleton" className="flex gap-2 px-[18px] pt-5">
      {columns.map((col, c) => (
        <div key={c} className="flex min-w-0 flex-1 flex-col gap-2">
          {col.map((r, i) => (
            <div
              key={i}
              className="skeleton w-full rounded-md"
              style={{
                aspectRatio: `1 / ${r}`,
                animationDelay: `${(c * 3 + i) * 80}ms`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function CollectionsRowSkeleton() {
  return (
    <div className="no-scrollbar flex gap-3 overflow-hidden px-[18px] pt-[18px]">
      <div className="relative h-[181px] w-[188px] shrink-0 rounded-[10px] border border-dashed border-[var(--border-dashed)]">
        <Plus
          size={22}
          strokeWidth={1.5}
          className="absolute left-1/2 top-[calc(50%-10px)] -translate-x-1/2 -translate-y-1/2 text-fg-subtle"
        />
        <span className="absolute bottom-[22px] left-4 text-small text-fg-faint">
          {fr.collection.new}
        </span>
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="h-[181px] w-[188px] shrink-0 rounded-[10px] border border-border bg-bg"
        >
          <div className="skeleton mx-auto mt-[22px] h-[104px] w-[84px] rounded-sm" />
        </div>
      ))}
    </div>
  )
}

export function AppShellSkeleton({ dark = false }: { dark?: boolean }) {
  return (
    <div data-testid="app-shell" className="flex h-full flex-col bg-bg text-fg" aria-busy="true">
      <header data-testid="header" className="app-drag relative h-24 shrink-0">
        <div className="absolute left-[18px] top-[41px] flex h-7 items-center gap-[14px]">
          <Logo />
          <span className="flex items-center gap-2 text-nav font-semibold tracking-[-0.01em]">
            {fr.nav.library}
            <ChevronsUpDown size={14} className="text-fg-subtle" />
          </span>
        </div>
        <NavSegmentedStatic />
        <HeaderActionsStatic dark={dark} />
      </header>
      <div
        data-testid="subheader"
        className="flex h-[61px] shrink-0 items-center justify-between border-b border-border-subtle px-8"
      >
        <LibraryTabsStatic />
        <SubbarRightStatic />
      </div>
      <main
        className="relative min-h-0 flex-1 overflow-y-auto pb-[100px]"
        aria-label={fr.app.loading}
      >
        <CollectionsRowSkeleton />
        <GridSkeleton />
      </main>
      <button
        type="button"
        aria-label={fr.fab.label}
        className="fab-surface fixed bottom-6 right-6 flex h-[52px] w-[52px] items-center justify-center rounded-full text-fg"
        style={{ boxShadow: 'var(--shadow-fab)' }}
      >
        <Plus size={24} strokeWidth={2} />
      </button>
    </div>
  )
}
